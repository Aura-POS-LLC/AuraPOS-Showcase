/**
 * Queue stream manager (poller + SSE bridge) that feeds queue state into the store.
 */

function tr(key, fallback, vars) {
  const lib = (typeof window !== 'undefined' && window.AuraI18n);
  if (lib && typeof lib.t === 'function') return lib.t(key, fallback, vars);
  return fallback || '';
}

function emitConnectionStatus(detail = {}) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  if (typeof window.CustomEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent('turn-manager:connection-status', { detail }));
}

export function createQueueStream(options = {}) {
  const {
    queueController = null,
    fetchImpl = (url, opts) => fetch(url, opts),
    EventSourceCtor = globalThis.SessionRequestAdapter?.EventSource || globalThis.EventSource || null,
    setQueueEntries = () => {},
    handleQueueStreamError = () => ({ nextCount: 0, shouldFallback: false, delay: 4000 }),
    withClientUserHeader = (headers = {}) => ({ ...(headers || {}) }),
    withClientUserQuery = (url) => String(url || ''),
    isSessionMismatchPayload = (payload) => {
      const reason = String(payload?.reason || '').trim();
      return reason === 'session_mismatch'
        || reason === 'session_rotated'
        || reason === 'missing_client_identity';
    },
    handleSessionMismatch = () => {},
    onError = () => {},
    onSuccess = () => {},
    liveConsistencyPollIntervalMs = 4000,
  } = options;

  let queueEventSource = null;
  let queueStreamReconnectTimer = null;
  let queueSseRecoveryTimer = null;
  let queueSseRecoveryAttempts = 0;
  let queueStreamFailureCount = 0;
  let queueFetchTimer = null;
  let queueLiveConsistencyTimer = null;
  let controllerUnsubscribe = null;
  let queueSyncMode = 'connecting';
  let queueVersion = '';
  let cachedQueueEntries = [];

  const QUEUE_REFRESH_MS = 15000;
  const SSE_RECOVERY_FIRST_DELAY_MS = 10000;
  const SSE_RECOVERY_RETRY_DELAY_MS = 30000;
  const LIVE_CONSISTENCY_POLL_MS = Number.isFinite(Number(liveConsistencyPollIntervalMs))
    ? Math.max(10, Math.trunc(Number(liveConsistencyPollIntervalMs)))
    : 4000;

  function normalizeQueueVersionToken(value) {
    return String(value ?? '').trim();
  }

  function buildQueueRequestUrl(force = false) {
    const token = normalizeQueueVersionToken(queueVersion);
    if (force || !token) return '/api/queue';
    return `/api/queue?since=${encodeURIComponent(token)}`;
  }

  function applyQueuePayload(items, metadata = {}) {
    const nextVersion = normalizeQueueVersionToken(metadata?.queueVersion);
    if (nextVersion) queueVersion = nextVersion;
    cachedQueueEntries = Array.isArray(items) ? items : [];
    setQueueEntries(cachedQueueEntries);
    clearError();
    return cachedQueueEntries;
  }

  function applyQueueDelta(payload = {}) {
    const nextVersion = normalizeQueueVersionToken(payload?.queueVersion);
    if (nextVersion) queueVersion = nextVersion;
    const removed = new Set(
      (Array.isArray(payload?.removedIds) ? payload.removedIds : [])
        .map(id => String(id))
        .filter(Boolean)
    );
    let nextEntries = Array.isArray(cachedQueueEntries) ? [...cachedQueueEntries] : [];
    if (removed.size) {
      nextEntries = nextEntries.filter(entry => !removed.has(String(entry?.id)));
    }
    (Array.isArray(payload?.items) ? payload.items : []).forEach((entry) => {
      if (!entry || !entry.id) return;
      const idx = nextEntries.findIndex(item => String(item?.id) === String(entry.id));
      if (idx >= 0) nextEntries[idx] = { ...entry };
      else nextEntries.push({ ...entry });
    });
    cachedQueueEntries = nextEntries;
    setQueueEntries(cachedQueueEntries);
    clearError();
    return cachedQueueEntries;
  }

  function applySnapshot(items, metadata = {}) {
    const list = Array.isArray(items) ? items : [];
    if (queueController && typeof queueController.setEntries === 'function') {
      const nextVersion = normalizeQueueVersionToken(metadata?.queueVersion);
      if (nextVersion) queueVersion = nextVersion;
      const entries = queueController.setEntries(list, metadata);
      cachedQueueEntries = Array.isArray(entries) ? entries : list;
      setQueueEntries(cachedQueueEntries);
      clearError();
      return cachedQueueEntries;
    }
    return applyQueuePayload(list, metadata);
  }

  function clearError() {
    onSuccess();
  }

  function setError(message) {
    if (typeof message === 'string' && message.length) {
      onError(message);
    } else {
      clearError();
    }
  }

  function currentQueueConnectionStatus() {
    if (queueSyncMode === 'polling') return 'polling';
    if (queueSyncMode === 'live') return 'live';
    if (queueSyncMode === 'recovering') return 'reconnecting';
    return 'connecting';
  }

  async function fetchQueueEntries(force = false) {
    try {
      if (queueController) {
        const entries = await queueController.refresh({ force });
        if (Array.isArray(entries)) {
          setQueueEntries(entries);
          clearError();
          emitConnectionStatus({
            source: 'queue',
            status: currentQueueConnectionStatus(),
          });
          return entries;
        }
        throw new Error('Invalid queue response');
      }
      const resp = await fetchImpl(buildQueueRequestUrl(force), {
        credentials: 'include',
        headers: withClientUserHeader(),
      });
      if (resp.status === 409 || resp.status === 401 || resp.status === 400) {
        const payload = await resp.json().catch(() => null);
        if (isSessionMismatchPayload(payload)) {
          handleSessionMismatch({ source: 'queue_poll', payload });
          return [];
        }
      }
      if (resp.status === 204) {
        clearError();
        return cachedQueueEntries;
      }
      if (!resp.ok) {
        throw new Error(`Queue fetch failed (${resp.status})`);
      }
      const data = await resp.json().catch(() => ({}));
      const items = Array.isArray(data.items) ? data.items : [];
      const nextEntries = applyQueuePayload(items, data);
      emitConnectionStatus({
        source: 'queue',
        status: currentQueueConnectionStatus(),
      });
      return nextEntries;
    } catch (err) {
      console.error('Queue fetch failed', err);
      emitConnectionStatus({
        source: 'queue',
        status: 'error',
      });
      setError(tr('tm.error.unableLoadWaitlist', 'Unable to load waitlist.'));
      throw err;
    }
  }

  function stopQueueSseRecovery() {
    if (queueSseRecoveryTimer) {
      clearTimeout(queueSseRecoveryTimer);
      queueSseRecoveryTimer = null;
    }
  }

  function scheduleQueueSseRecovery() {
    if (typeof EventSource !== 'function') return;
    if (queueSseRecoveryTimer) return;
    const delay = queueSseRecoveryAttempts > 0
      ? SSE_RECOVERY_RETRY_DELAY_MS
      : SSE_RECOVERY_FIRST_DELAY_MS;
    queueSseRecoveryAttempts += 1;
    queueSseRecoveryTimer = setTimeout(() => {
      queueSseRecoveryTimer = null;
      if (queueSyncMode !== 'polling') return;
      if (queueController && typeof queueController.startStream === 'function') {
        startQueueControllerStream(true, { keepPollerUntilOpen: true });
      } else {
        startQueueEventStream(true, { keepPollerUntilOpen: true });
      }
    }, delay);
  }

  function startQueuePoller({ recoverSse = false } = {}) {
    stopQueuePoller();
    stopLiveConsistencyPoller();
    queueSyncMode = 'polling';
    emitConnectionStatus({
      source: 'queue',
      status: 'polling',
    });
    queueFetchTimer = setInterval(() => {
      fetchQueueEntries().catch(() => {});
    }, QUEUE_REFRESH_MS);
    if (recoverSse) scheduleQueueSseRecovery();
  }

  function stopLiveConsistencyPoller() {
    if (queueLiveConsistencyTimer) {
      clearInterval(queueLiveConsistencyTimer);
      queueLiveConsistencyTimer = null;
    }
  }

  function startLiveConsistencyPoller() {
    stopLiveConsistencyPoller();
    queueLiveConsistencyTimer = setInterval(() => {
      if (queueSyncMode !== 'live') return;
      fetchQueueEntries(false).catch(() => {});
    }, LIVE_CONSISTENCY_POLL_MS);
  }

  function stopQueuePoller() {
    if (queueFetchTimer) {
      clearInterval(queueFetchTimer);
      queueFetchTimer = null;
    }
  }

  function subscribeToController() {
    if (!queueController || typeof queueController.subscribe !== 'function') return;
    controllerUnsubscribe = queueController.subscribe((entries) => {
      if (Array.isArray(entries)) {
        setQueueEntries(entries);
        clearError();
      }
    });
  }

  function unsubscribeController() {
    if (typeof controllerUnsubscribe === 'function') {
      try { controllerUnsubscribe(); } catch (_) {}
    }
    controllerUnsubscribe = null;
  }

  function startQueueEventStream(isRetry = false, options = {}) {
    const keepPollerUntilOpen = options.keepPollerUntilOpen === true;
    stopQueueEventStream();
    if (!keepPollerUntilOpen) {
      stopQueuePoller();
      stopLiveConsistencyPoller();
      stopQueueSseRecovery();
      queueSseRecoveryAttempts = 0;
    }
    if (typeof EventSource !== 'function') {
      startQueuePoller();
      return;
    }
    queueSyncMode = keepPollerUntilOpen ? 'recovering' : 'connecting';
    emitConnectionStatus({
      source: 'queue',
      status: isRetry ? 'reconnecting' : 'connecting',
    });
    if (typeof EventSourceCtor !== 'function') return;
    const es = new EventSourceCtor(withClientUserQuery('/api/queue/stream?queue_delta=1'));
    queueEventSource = es;
    es.addEventListener('open', () => {
      if (queueEventSource !== es) return;
      queueSyncMode = 'live';
      queueStreamFailureCount = 0;
      queueSseRecoveryAttempts = 0;
      stopQueueSseRecovery();
      stopQueuePoller();
      startLiveConsistencyPoller();
      emitConnectionStatus({
        source: 'queue',
        status: 'live',
      });
    });

    es.addEventListener('customer_queue', (event) => {
      if (queueEventSource !== es) return;
      try {
        const data = JSON.parse(event.data || '{}');
        if (Array.isArray(data.items)) {
          applyQueuePayload(data.items, data);
          queueSyncMode = 'live';
          queueStreamFailureCount = 0;
          startLiveConsistencyPoller();
          emitConnectionStatus({
            source: 'queue',
            status: 'live',
          });
        }
      } catch (err) {
        console.error('Queue stream parse failed', err);
      }
    });

    es.addEventListener('customer_queue_delta', (event) => {
      try {
        const data = JSON.parse(event.data || '{}');
        applyQueueDelta(data);
      } catch (err) {
        console.error('Queue stream delta parse failed', err);
      }
    });

    es.addEventListener('error', () => {
      if (queueEventSource !== es) return;
      stopQueueEventStream();
      const { nextCount, shouldFallback, delay } = handleQueueStreamError({
        failureCount: queueStreamFailureCount,
        threshold: 3,
        reconnectDelayMs: 4000,
      });
      queueStreamFailureCount = nextCount;
      if (keepPollerUntilOpen) {
        queueSyncMode = 'polling';
        emitConnectionStatus({
          source: 'queue',
          status: 'polling',
        });
        scheduleQueueSseRecovery();
        return;
      }
      if (shouldFallback) {
        startQueuePoller({ recoverSse: true });
        return;
      }
      emitConnectionStatus({
        source: 'queue',
        status: 'reconnecting',
      });
      queueStreamReconnectTimer = setTimeout(() => {
        queueStreamReconnectTimer = null;
        startQueueEventStream(true);
      }, delay);
    });

    es.addEventListener('session', (event) => {
      if (queueEventSource !== es) return;
      let payload = null;
      try { payload = JSON.parse(event?.data || '{}'); } catch (_) {}
      if (!isSessionMismatchPayload(payload)) return;
      stopQueueEventStream();
      handleSessionMismatch({ source: 'queue_stream', payload });
    });
  }

  function startQueueControllerStream(isRetry = false, options = {}) {
    if (!queueController || typeof queueController.startStream !== 'function') return;
    const keepPollerUntilOpen = options.keepPollerUntilOpen === true;
    if (!keepPollerUntilOpen) {
      stopQueueSseRecovery();
      stopLiveConsistencyPoller();
      queueSseRecoveryAttempts = 0;
    }
    queueSyncMode = keepPollerUntilOpen ? 'recovering' : 'connecting';
    emitConnectionStatus({
      source: 'queue',
      status: isRetry ? 'reconnecting' : 'connecting',
    });
    queueController.startStream({
      onOpen: () => {
        queueSyncMode = 'live';
        queueSseRecoveryAttempts = 0;
        stopQueueSseRecovery();
        stopQueuePoller();
        startLiveConsistencyPoller();
        emitConnectionStatus({ source: 'queue', status: 'live' });
      },
      onUpdate: () => {
        queueSyncMode = 'live';
        queueSseRecoveryAttempts = 0;
        stopQueueSseRecovery();
        stopQueuePoller();
        startLiveConsistencyPoller();
        emitConnectionStatus({ source: 'queue', status: 'live' });
      },
      onReconnect: () => {
        emitConnectionStatus({ source: 'queue', status: 'reconnecting' });
      },
      onFallback: () => {
        queueSyncMode = 'polling';
        emitConnectionStatus({ source: 'queue', status: 'polling' });
        startQueuePoller({ recoverSse: true });
      },
      onError: () => {
        emitConnectionStatus({ source: 'queue', status: 'error' });
      },
    });
  }

  function stopQueueEventStream() {
    stopLiveConsistencyPoller();
    if (queueEventSource) {
      try { queueEventSource.close(); } catch (_) {}
      queueEventSource = null;
    }
    if (queueStreamReconnectTimer) {
      clearTimeout(queueStreamReconnectTimer);
      queueStreamReconnectTimer = null;
    }
  }

  function startRealtime() {
    stopRealtime();
    if (queueController) {
      subscribeToController();
      if (typeof queueController.startStream === 'function') {
        startQueueControllerStream();
      }
      return fetchQueueEntries(true).catch(() => {});
    }
    if (typeof EventSource === 'function') {
      startQueueEventStream();
    } else {
      startQueuePoller();
    }
    return fetchQueueEntries(true).catch(() => {});
  }

  function stopRealtime() {
    stopQueuePoller();
    stopLiveConsistencyPoller();
    stopQueueEventStream();
    stopQueueSseRecovery();
    if (queueController && typeof queueController.stopStream === 'function') {
      queueController.stopStream();
    }
    unsubscribeController();
  }

  return {
    startRealtime,
    stopRealtime,
    refresh: fetchQueueEntries,
    applySnapshot,
  };
}

const TurnManagerQueueStream = { createQueueStream };

if (typeof window !== 'undefined') {
  window.TurnManagerQueueStream = Object.freeze({
    ...(window.TurnManagerQueueStream || {}),
    createQueueStream,
  });
}

export default TurnManagerQueueStream;
