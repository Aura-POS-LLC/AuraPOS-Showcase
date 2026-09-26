/**
 * Board persistence + realtime sync module.
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

function defaultBoardDateKey(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeBoardDateKey(value) {
  if (value === undefined || value === null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const dateOnly = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : '';
}

export function createBoardStream(options = {}) {
  const {
    getTechnicians = () => [],
    setTechnicians = () => {},
    getSignInPool = () => [],
    setSignInPool = () => {},
    getSignInPoolDefault = () => [],
    getSelectedBox = () => null,
    setSelectedBox = () => {},
    getBoxCount = () => 0,
    getCachedSettings = () => ({}),
    skillNamesForTech = () => [],
    techByName = () => null,
    renderTechGrid = () => {},
    renderAvailableList = () => {},
    updateGlobalActionButtons = () => {},
    sanitizeSelectedBox = () => {},
    getCheckoutHistory = () => [],
    syncCheckoutHistoryFromBoard = () => {},
    writeBoardCache = () => {},
    readBoardCache = () => null,
    mergeServerBoardPayload = () => null,
    shouldQueueRemoteBoard = () => false,
    makeBoardStorageKey = () => 'board',
    boardKeyPrefix = '',
    getBoardDateKey = defaultBoardDateKey,
    fetchImpl = (url, opts) => fetch(url, opts),
    EventSourceCtor = globalThis.SessionRequestAdapter?.EventSource || globalThis.EventSource || null,
    showToast = () => {},
    onBoardApplied = () => {},
    liveConsistencyPollIntervalMs = 4000,
  } = options;

  const boardSessionDateKey = normalizeBoardDateKey(getBoardDateKey()) || defaultBoardDateKey();
  let boardVersion = 0;
  let boardPollTimer = null;
  let boardLiveConsistencyPollTimer = null;
  let pendingSaveTimer = null;
  let lastPollErrorLogged = false;
  let sessionExpired = false;
  let saveInFlight = false;
  let hasDirtyChanges = false;
  let queuedRemoteBoard = null;
  let pendingLocalBoardSnapshot = null;
  let pendingBoardAction = 'update_turn';
  let forceNextSave = false;
  let boardEventSource = null;
  let boardStreamReconnectTimer = null;
  let boardSseRecoveryTimer = null;
  let boardSseRecoveryAttempts = 0;
  let boardStreamFailureCount = 0;
  let boardSyncMode = 'connecting';
  let initialized = false;
  let lastSessionCheckAt = 0;
  let sessionMismatchReloading = false;
  let lastHiddenAt = Date.now();
  let lastBoardSyncAt = 0;

  const SAVE_RETRY_DELAY = 220;
  const SESSION_CHECK_COOLDOWN = 1000;
  const TURN_MANAGER_REFRESH_FLAG = 'turnManagerNeedsRefresh';
  const STALE_REFRESH_MS = 5 * 60 * 1000;
  const SSE_RECOVERY_FIRST_DELAY_MS = 10000;
  const SSE_RECOVERY_RETRY_DELAY_MS = 30000;
  const LIVE_CONSISTENCY_POLL_MS = Number.isFinite(Number(liveConsistencyPollIntervalMs))
    ? Math.max(10, Math.trunc(Number(liveConsistencyPollIntervalMs)))
    : 4000;
  const CHECKOUT_SETTINGS_KEY_PREFIX = 'checkoutSettings:v1';
  const CHECKOUT_STATION_KEY_PREFIX = 'checkout_station_v1';
  const accountIdentity = (typeof window !== 'undefined' && window.AccountIdentity) || {};
  const resolveAccountUserKey = (typeof accountIdentity.resolveAccountUserKey === 'function')
    ? accountIdentity.resolveAccountUserKey.bind(accountIdentity)
    : null;
  const makeScopedStorageKey = (typeof accountIdentity.makeScopedStorageKey === 'function')
    ? accountIdentity.makeScopedStorageKey.bind(accountIdentity)
    : null;
  const BOARD_ENDPOINTS = {
    update_turn: { url: '/api/turns/update', method: 'POST' },
    delete_turn: { url: '/api/turns/delete', method: 'POST' },
    request_turn: { url: '/api/turns/request', method: 'POST' },
  };

  function isSessionGuardReason(reason) {
    const normalized = String(reason || '').trim();
    return normalized === 'session_mismatch'
      || normalized === 'session_rotated'
      || normalized === 'missing_client_identity';
  }

  function parsePrinterStation(raw) {
    if (!raw) return '';
    try {
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        const station = typeof data?.printerStation === 'string' ? data.printerStation.trim().slice(0, 40) : '';
        if (station) return station;
      }
    } catch (_) {
      // ignore parse errors and return empty station.
    }
    return '';
  }

  function getPrinterStation() {
    try {
      const storage = window?.localStorage;
      if (!storage) return null;
      const scopedStationKey = makeScopedStorageKey
        ? makeScopedStorageKey(CHECKOUT_STATION_KEY_PREFIX, window)
        : `${CHECKOUT_STATION_KEY_PREFIX}:${currentUserKey()}`;
      const scopedStation = parsePrinterStation(storage.getItem(scopedStationKey));
      if (scopedStation) return scopedStation;
      const legacyUserScopedKey = `${CHECKOUT_SETTINGS_KEY_PREFIX}:${currentUserKey()}`;
      const legacyUserScopedStation = parsePrinterStation(storage.getItem(legacyUserScopedKey));
      return legacyUserScopedStation || null;
    } catch (_) {
      return null;
    }
  }

  function boardStorageKey() {
    return makeBoardStorageKey(boardKeyPrefix, currentUserKey());
  }

  function currentTimezoneOffset() {
    const offset = new Date().getTimezoneOffset();
    return Number.isFinite(offset) ? offset : 0;
  }

  function currentBoardDateKey() {
    return normalizeBoardDateKey(getBoardDateKey()) || defaultBoardDateKey();
  }

  function currentUserKey() {
    if (resolveAccountUserKey) {
      return resolveAccountUserKey(window);
    }
    if (typeof window === 'undefined') return 'guest';
    const rawId = window.CURRENT_USER_ID;
    if (rawId !== null && rawId !== undefined && String(rawId).trim().length) {
      return `uid:${String(rawId).trim()}`;
    }
    return 'guest';
  }

  function currentUserId() {
    if (typeof window === 'undefined') return null;
    const rawId = window.CURRENT_USER_ID;
    if (rawId === null || rawId === undefined) return null;
    const trimmed = String(rawId).trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function withClientUserHeader(headers = {}) {
    const next = { ...(headers || {}) };
    const id = currentUserId();
    if (Number.isFinite(id)) {
      next['x-client-user-id'] = String(id);
    }
    return next;
  }

  function snapshotBoardState() {
    return {
      boardDate: boardSessionDateKey,
      signInPool: getSignInPool(),
      technicians: getTechnicians(),
      boxCount: getBoxCount(),
      checkoutHistory: getCheckoutHistory(),
    };
  }

  function writeCachedBoardState(board, version, boardDate = '') {
    writeBoardCache(localStorage, boardStorageKey(), board, version, boardDate || board?.boardDate || boardSessionDateKey);
  }

  function readCachedBoardState() {
    return readBoardCache(localStorage, boardStorageKey(), { expectedBoardDate: boardSessionDateKey });
  }

  function applyBoardState(board, context = {}) {
    const boxCount = getBoxCount();
    const technicians = Array.isArray(board?.technicians)
      ? board.technicians.map(t => ({
          name: t.name,
          boxes: Array.isArray(t.boxes)
            ? t.boxes
                .slice(0, boxCount)
                .concat(Array(Math.max(0, boxCount - t.boxes.length)).fill(null))
            : Array(boxCount).fill(null),
          checkInAt: t.checkInAt ?? Date.now(),
          skipped: !!t.skipped,
          skills: Array.isArray(t.skills) ? [...t.skills] : [],
        }))
      : [];
    const settingsForSkills = getCachedSettings() || {};
    technicians.forEach(t => {
      t.skills = skillNamesForTech(t.name, settingsForSkills);
    });
    setTechnicians(technicians);

    sanitizeSelectedBox();

    const rosterSet = new Set(technicians.map(t => t.name));
    const incomingPool = Array.isArray(board?.signInPool) ? [...board.signInPool] : null;
    const defaults = getSignInPoolDefault().filter(name => !rosterSet.has(name));
    const defaultsSet = new Set(defaults);
    let pool = incomingPool !== null
      ? incomingPool.filter(name => !rosterSet.has(name) && defaultsSet.has(name))
      : [];
    pool = Array.from(new Set(pool));
    if (pool.length === 0) {
      pool = [...defaults];
    } else {
      defaults.forEach((name) => {
        if (!pool.includes(name)) pool.push(name);
      });
    }
    setSignInPool(pool);

    if (Array.isArray(board?.checkoutHistory)) {
      syncCheckoutHistoryFromBoard(board.checkoutHistory);
    } else {
      syncCheckoutHistoryFromBoard([]);
    }

    renderTechGrid();
    renderAvailableList(true);
    updateGlobalActionButtons();
    if (typeof onBoardApplied === 'function') {
      onBoardApplied(board, context);
    }
  }

  function applyNormalizedBoardPayload(payload, options = {}) {
    const normalized = mergeServerBoardPayload(payload, boardVersion);
    if (!normalized) return;
    const { animateAvailable = true, authoritative = false } = options;
    const skipQueueAutoSync = options?.skipQueueAutoSync === true
      || payload?.skipQueueAutoSync === true
      || payload?.queueReset === true;
    if (authoritative) {
      if (pendingSaveTimer) {
        clearTimeout(pendingSaveTimer);
        pendingSaveTimer = null;
      }
      hasDirtyChanges = false;
      pendingLocalBoardSnapshot = null;
      queuedRemoteBoard = null;
      pendingBoardAction = 'update_turn';
      forceNextSave = false;
    }
    boardVersion = normalized.version;
    applyBoardState(normalized.board, {
      sourcePayload: payload,
      authoritative,
      skipQueueAutoSync,
    });
    writeCachedBoardState(normalized.board, boardVersion, normalized.boardDate);
    renderAvailableList(animateAvailable);
    markBoardSynced();
  }

  function applyLocalBoardSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    const rosterSet = new Set(Array.isArray(snapshot?.technicians) ? snapshot.technicians.map(t => t.name) : []);
    const defaults = getSignInPoolDefault().filter(name => !rosterSet.has(name));
    const defaultsSet = new Set(defaults);
    const incoming = Array.isArray(snapshot?.signInPool)
      ? snapshot.signInPool.filter(name => !rosterSet.has(name) && defaultsSet.has(name))
      : [];
    const merged = incoming.length ? Array.from(new Set(incoming)) : [];
    defaults.forEach((name) => {
      if (!merged.includes(name)) merged.push(name);
    });
    setSignInPool(merged.length ? merged : defaults);
    setTechnicians(snapshot.technicians || []);
    syncCheckoutHistoryFromBoard(snapshot.checkoutHistory || []);
    renderTechGrid();
    renderAvailableList(false);
    updateGlobalActionButtons();
    if (typeof onBoardApplied === 'function') {
      onBoardApplied(snapshot);
    }
  }

  async function fetchBoardStateFromServer(version = null) {
    const params = new URLSearchParams();
    if (version != null) params.set('since', String(version));
    const boardDate = currentBoardDateKey();
    if (boardDate) params.set('boardDate', boardDate);
    params.set('timezoneOffset', String(currentTimezoneOffset()));
    const query = params.toString();
    const resp = await fetchImpl(`/api/board${query ? `?${query}` : ''}`, {
      credentials: 'include',
      headers: withClientUserHeader(),
    });
    if (resp.status === 401) {
      let data = null;
      try { data = await resp.json(); } catch (_) {}
      if (data && isSessionGuardReason(data.reason)) {
        console.warn('Turn manager session changed; reloading.');
        triggerSessionMismatchReload();
        return null;
      }
      handleSessionExpired();
      return null;
    }
    if (resp.status === 409) {
      let data = null;
      try { data = await resp.json(); } catch (_) {}
      if (data && isSessionGuardReason(data.reason)) {
        console.warn('Turn manager session changed; reloading.');
        triggerSessionMismatchReload();
        return null;
      }
      throw new Error('Board fetch conflict');
    }
    if (resp.status === 204) return null;
    if (!resp.ok) throw new Error(`Board fetch failed (${resp.status})`);
    return resp.json();
  }

  async function persistBoardState() {
    if (sessionExpired) return;
    if (saveInFlight) {
      queueSaveRetry(SAVE_RETRY_DELAY);
      return;
    }

    const payload = snapshotBoardState();
    pendingLocalBoardSnapshot = payload;
    const action = pendingBoardAction || 'update_turn';
    const endpointConfig = BOARD_ENDPOINTS[action] || BOARD_ENDPOINTS.update_turn;
    pendingBoardAction = 'update_turn';
    saveInFlight = true;
    const forceSave = forceNextSave === true;
    try {
      const datedPayload = {
        ...payload,
        boardDate: boardSessionDateKey,
      };
      const body = {
        board: datedPayload,
        boardDate: boardSessionDateKey,
        timezoneOffset: currentTimezoneOffset(),
        station: getPrinterStation(),
        ...(forceSave ? { force: true } : { version: boardVersion }),
      };
      const resp = await fetchImpl(endpointConfig.url, {
        method: endpointConfig.method,
        credentials: 'include',
        headers: withClientUserHeader({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });

      if (resp.status === 401) {
        let data = null;
        try { data = await resp.json(); } catch (_) {}
        if (data && isSessionGuardReason(data.reason)) {
          console.warn('Turn manager session changed; reloading.');
          triggerSessionMismatchReload();
          return;
        }
        hasDirtyChanges = false;
        handleSessionExpired();
        return;
      }

      if (resp.status === 409) {
        let data = null;
        try { data = await resp.json(); } catch (_) {}
        if (data && isSessionGuardReason(data.reason)) {
          console.warn('Turn manager session changed; reloading.');
          triggerSessionMismatchReload();
          return;
        }
        if (data) {
          console.warn('Board version conflict; refreshing from server.');
          applyNormalizedBoardPayload(data, { animateAvailable: true });
          queuedRemoteBoard = null;
        }
        pendingLocalBoardSnapshot = null;
        hasDirtyChanges = false;
        showToast(tr('tm.toast.boardUpdatedElsewhere', 'Board updated elsewhere, refreshing…'), 'info');
        lastPollErrorLogged = false;
        return;
      }

      if (!resp.ok) throw new Error(`Board save failed (${resp.status})`);
      const data = await resp.json();
      boardVersion = typeof data.version === 'number' ? data.version : boardVersion;
      writeCachedBoardState(datedPayload, boardVersion, boardSessionDateKey);
      markBoardSynced();
      lastPollErrorLogged = false;
      hasDirtyChanges = false;
      pendingLocalBoardSnapshot = null;
      if (forceSave) forceNextSave = false;
      showToast(tr('tm.toast.turnBoardSynced', 'Turn board synced'), 'success');
    } catch (err) {
      emitConnectionStatus({
        source: 'board',
        status: 'save-error',
      });
      if (!lastPollErrorLogged) {
        console.error(err);
        lastPollErrorLogged = true;
      }
      showToast(tr('tm.toast.failedSyncBoard', 'Failed to sync board'), 'error');
      if (forceSave) forceNextSave = true;
      queueSaveRetry(Math.min(1000, SAVE_RETRY_DELAY * 4));
    } finally {
      saveInFlight = false;
      flushQueuedServerBoard();
    }
  }

  function queueSaveRetry(delay = SAVE_RETRY_DELAY) {
    if (sessionExpired) return;
    hasDirtyChanges = true;
    if (pendingSaveTimer) clearTimeout(pendingSaveTimer);
    pendingSaveTimer = setTimeout(() => {
      pendingSaveTimer = null;
      persistBoardState();
    }, delay);
  }

  function saveState() {
    if (sessionExpired) return;
    hasDirtyChanges = true;
    if (pendingSaveTimer) clearTimeout(pendingSaveTimer);
    pendingSaveTimer = setTimeout(() => {
      pendingSaveTimer = null;
      persistBoardState();
    }, 250);
  }

  function queueBoardAction(kind = 'update_turn', options = {}) {
    pendingBoardAction = kind || 'update_turn';
    if (options && options.force) forceNextSave = true;
    saveState();
  }

  function flushQueuedServerBoard() {
    if (!queuedRemoteBoard || shouldQueueRemoteBoard({ hasDirtyChanges, saveInFlight })) return;
    const normalized = mergeServerBoardPayload(queuedRemoteBoard, boardVersion);
    queuedRemoteBoard = null;
    if (!normalized) return;
    if (normalized.version < boardVersion) return;
    applyNormalizedBoardPayload(normalized, { animateAvailable: true });
    lastPollErrorLogged = false;
  }

  function handleSessionExpired() {
    if (sessionExpired) return;
    sessionExpired = true;
    stopBoardPoller();
    stopLiveConsistencyPoller();
    if (boardEventSource) {
      try { boardEventSource.close(); } catch (_) {}
      boardEventSource = null;
    }
    if (boardStreamReconnectTimer) {
      clearTimeout(boardStreamReconnectTimer);
      boardStreamReconnectTimer = null;
    }
    if (pendingSaveTimer) {
      clearTimeout(pendingSaveTimer);
      pendingSaveTimer = null;
    }
    console.warn('Session expired; redirecting to login.');
    hasDirtyChanges = false;
    saveInFlight = false;
    const next = `${window.location.pathname}${window.location.search || ''}`;
    queuedRemoteBoard = null;
    window.location.href = `/login?next=${encodeURIComponent(next)}`;
  }

  function stopRealtime() {
    sessionExpired = true;
    stopBoardPoller();
    stopLiveConsistencyPoller();
    stopBoardSseRecovery();
    if (boardEventSource) {
      try { boardEventSource.close(); } catch (_) {}
      boardEventSource = null;
    }
    if (boardStreamReconnectTimer) {
      clearTimeout(boardStreamReconnectTimer);
      boardStreamReconnectTimer = null;
    }
    if (pendingSaveTimer) {
      clearTimeout(pendingSaveTimer);
      pendingSaveTimer = null;
    }
    hasDirtyChanges = false;
    saveInFlight = false;
    queuedRemoteBoard = null;
    pendingLocalBoardSnapshot = null;
    emitConnectionStatus({ source: 'board', status: 'inactive', reason: 'account_changed' });
  }

  function triggerSessionMismatchReload() {
    if (sessionMismatchReloading) return;
    sessionMismatchReloading = true;
    showToast(tr('tm.toast.sessionChangedRefreshing', 'Session changed, refreshing…'), 'info');
    const url = new URL(window.location.href);
    url.searchParams.set('session_refresh', String(Date.now()));
    setTimeout(() => {
      window.location.replace(url.toString());
    }, 450);
  }

  function checkForSessionMismatch() {
    if (sessionExpired) return;
    const loggedIn = window.USER_IS_LOGGED_IN === true || window.USER_IS_LOGGED_IN === 'true';
    if (!loggedIn) return;
    const now = Date.now();
    if (now - lastSessionCheckAt < SESSION_CHECK_COOLDOWN) return;
    lastSessionCheckAt = now;
    fetchBoardStateFromServer(boardVersion)
      .then((data) => {
        if (!data || !data.board) return;
        if (shouldQueueRemoteBoard({ hasDirtyChanges, saveInFlight })) {
          queuedRemoteBoard = data;
        } else {
          applyNormalizedBoardPayload(data, { animateAvailable: false });
          lastPollErrorLogged = false;
        }
      })
      .catch((err) => {
        if (!lastPollErrorLogged) {
          console.error('Board sync check failed', err);
          lastPollErrorLogged = true;
        }
      });
  }

  function markBoardSynced() {
    lastBoardSyncAt = Date.now();
    if (typeof window !== 'undefined') {
      window.TURN_BOARD_LAST_SYNC = lastBoardSyncAt;
    }
    if (boardSyncMode === 'live' || boardSyncMode === 'polling') {
      emitConnectionStatus({
        source: 'board',
        status: boardSyncMode === 'polling' ? 'polling' : 'live',
      });
    }
  }

  async function forceRefreshFromServer() {
    if (sessionExpired) return;
    if (pendingSaveTimer) {
      clearTimeout(pendingSaveTimer);
      pendingSaveTimer = null;
    }
    hasDirtyChanges = false;
    saveInFlight = false;
    queuedRemoteBoard = null;
    pendingLocalBoardSnapshot = null;
    try {
      const data = await fetchBoardStateFromServer(null);
      if (data && data.board) {
        applyNormalizedBoardPayload(data, { animateAvailable: false });
        lastPollErrorLogged = false;
      }
    } catch (err) {
      if (!lastPollErrorLogged) {
        console.error('Failed to refresh board from server', err);
        lastPollErrorLogged = true;
      }
    }
  }

  function clearState() {
    boardVersion = 0;
    try {
      localStorage.removeItem(boardStorageKey());
    } catch (_) {}
  }

  async function loadInitialBoardState() {
    const cached = readCachedBoardState();
    if (cached) {
      boardVersion = typeof cached.version === 'number' ? cached.version : 0;
      applyBoardState(cached.board || {});
    }

    const loggedIn = window.USER_IS_LOGGED_IN === true || window.USER_IS_LOGGED_IN === 'true';
    if (!loggedIn) {
      return Boolean(cached);
    }

    try {
      const data = await fetchBoardStateFromServer(boardVersion || null);
      if (data && data.board) {
        applyNormalizedBoardPayload(data, { animateAvailable: false });
        lastPollErrorLogged = false;
        return true;
      }
    } catch (err) {
      if (!lastPollErrorLogged) {
        console.error('Failed to load board from server', err);
        lastPollErrorLogged = true;
      }
    }

    return Boolean(cached);
  }

  function stopBoardSseRecovery() {
    if (boardSseRecoveryTimer) {
      clearTimeout(boardSseRecoveryTimer);
      boardSseRecoveryTimer = null;
    }
  }

  function scheduleBoardSseRecovery() {
    if (sessionExpired || typeof EventSource === 'undefined') return;
    if (boardSseRecoveryTimer) return;
    const delay = boardSseRecoveryAttempts > 0
      ? SSE_RECOVERY_RETRY_DELAY_MS
      : SSE_RECOVERY_FIRST_DELAY_MS;
    boardSseRecoveryAttempts += 1;
    boardSseRecoveryTimer = setTimeout(() => {
      boardSseRecoveryTimer = null;
      if (sessionExpired || boardSyncMode !== 'polling') return;
      startBoardEventStream(true, { keepPollerUntilOpen: true });
    }, delay);
  }

  async function pollBoardForRemoteUpdate({
    animateAvailable = true,
    errorLabel = 'Board poll failed',
    forceFullFetch = false,
  } = {}) {
    try {
      const data = await fetchBoardStateFromServer(forceFullFetch ? null : boardVersion);
      if (data && data.board) {
        if (shouldQueueRemoteBoard({ hasDirtyChanges, saveInFlight })) {
          queuedRemoteBoard = data;
        } else {
          applyNormalizedBoardPayload(data, { animateAvailable });
          lastPollErrorLogged = false;
        }
      }
    } catch (err) {
      emitConnectionStatus({
        source: 'board',
        status: 'error',
      });
      if (!lastPollErrorLogged) {
        console.error(errorLabel, err);
        lastPollErrorLogged = true;
      }
    }
    flushQueuedServerBoard();
  }

  function stopLiveConsistencyPoller() {
    if (boardLiveConsistencyPollTimer) {
      clearInterval(boardLiveConsistencyPollTimer);
      boardLiveConsistencyPollTimer = null;
    }
  }

  function startLiveConsistencyPoller() {
    stopLiveConsistencyPoller();
    if (sessionExpired) return;
    const loggedIn = window.USER_IS_LOGGED_IN === true || window.USER_IS_LOGGED_IN === 'true';
    if (!loggedIn) return;
    boardLiveConsistencyPollTimer = setInterval(() => {
      if (sessionExpired || boardSyncMode !== 'live') return;
      pollBoardForRemoteUpdate({
        animateAvailable: true,
        errorLabel: 'Board live consistency poll failed',
        forceFullFetch: true,
      });
    }, LIVE_CONSISTENCY_POLL_MS);
  }

  function startBoardPoller({ recoverSse = false } = {}) {
    if (boardPollTimer) clearInterval(boardPollTimer);
    stopLiveConsistencyPoller();
    if (sessionExpired) return;
    const loggedIn = window.USER_IS_LOGGED_IN === true || window.USER_IS_LOGGED_IN === 'true';
    if (!loggedIn) return;

    boardSyncMode = 'polling';
    emitConnectionStatus({
      source: 'board',
      status: 'polling',
    });
    boardPollTimer = setInterval(() => {
      pollBoardForRemoteUpdate({ animateAvailable: true });
    }, 4000);
    if (recoverSse) scheduleBoardSseRecovery();
  }

  function stopBoardPoller() {
    if (boardPollTimer) {
      clearInterval(boardPollTimer);
      boardPollTimer = null;
    }
  }

  function startBoardEventStream(isRetry = false, options = {}) {
    const keepPollerUntilOpen = options.keepPollerUntilOpen === true;
    if (sessionExpired) return;
    if (!keepPollerUntilOpen) {
      stopBoardPoller();
      stopLiveConsistencyPoller();
      stopBoardSseRecovery();
      boardSseRecoveryAttempts = 0;
    }
    if (boardEventSource) {
      try { boardEventSource.close(); } catch (_) {}
      boardEventSource = null;
    }
    stopLiveConsistencyPoller();
    if (typeof EventSource === 'undefined') {
      startBoardPoller();
      return;
    }
    boardSyncMode = keepPollerUntilOpen ? 'recovering' : 'connecting';
    emitConnectionStatus({
      source: 'board',
      status: isRetry ? 'reconnecting' : 'connecting',
    });
    const clientId = currentUserId();
    const streamParams = new URLSearchParams();
    if (Number.isFinite(clientId)) streamParams.set('client_uid', String(clientId));
    streamParams.set('timezoneOffset', String(currentTimezoneOffset()));
    const currentDate = currentBoardDateKey();
    if (currentDate) streamParams.set('boardDate', currentDate);
    const streamQuery = streamParams.toString();
    const streamUrl = `/api/board/stream${streamQuery ? `?${streamQuery}` : ''}`;
    if (typeof EventSourceCtor !== 'function') return;
    const es = new EventSourceCtor(streamUrl);
    boardEventSource = es;
    es.addEventListener('open', () => {
      if (boardEventSource !== es) return;
      boardSyncMode = 'live';
      boardStreamFailureCount = 0;
      boardSseRecoveryAttempts = 0;
      stopBoardSseRecovery();
      stopBoardPoller();
      startLiveConsistencyPoller();
      emitConnectionStatus({
        source: 'board',
        status: 'live',
      });
    });
    es.addEventListener('session', (event) => {
      if (boardEventSource !== es) return;
      try {
        const data = JSON.parse(event.data || '{}');
        if (data && isSessionGuardReason(data.reason)) {
          console.warn('Turn manager session changed; reloading.');
          triggerSessionMismatchReload();
        }
      } catch (_) {}
    });
    es.addEventListener('board', (event) => {
      if (boardEventSource !== es) return;
      try {
        const data = JSON.parse(event.data || '{}');
        if (!data || typeof data !== 'object' || !data.board) return;
        if (shouldQueueRemoteBoard({ hasDirtyChanges, saveInFlight })) {
          queuedRemoteBoard = data;
        } else {
          applyNormalizedBoardPayload(data, { animateAvailable: true });
          boardSyncMode = 'live';
          boardStreamFailureCount = 0;
          lastPollErrorLogged = false;
        }
      } catch (err) {
        console.error('Failed to parse board event', err);
      }
    });
    es.addEventListener('error', () => {
      if (boardEventSource !== es) return;
      try { es.close(); } catch (_) {}
      boardEventSource = null;
      stopLiveConsistencyPoller();
      boardStreamFailureCount += 1;
      if (boardStreamReconnectTimer) {
        clearTimeout(boardStreamReconnectTimer);
        boardStreamReconnectTimer = null;
      }
      if (sessionExpired) return;
      if (keepPollerUntilOpen) {
        boardSyncMode = 'polling';
        emitConnectionStatus({
          source: 'board',
          status: 'polling',
        });
        scheduleBoardSseRecovery();
        return;
      }
      if (boardStreamFailureCount >= 3) {
        startBoardPoller({ recoverSse: true });
        return;
      }
      emitConnectionStatus({
        source: 'board',
        status: 'reconnecting',
      });
      boardStreamReconnectTimer = setTimeout(() => {
        boardStreamReconnectTimer = null;
        startBoardEventStream(true);
      }, 4000);
    });
  }

  function startBoardRealtime() {
    if (typeof EventSource === 'function') {
      startBoardEventStream();
    } else {
      startBoardPoller();
    }
  }

  function initialize() {
    if (initialized || typeof window === 'undefined') return;
    initialized = true;
    window.addEventListener('pageshow', (event) => {
      let needsRefresh = false;
      try {
        if (sessionStorage.getItem(TURN_MANAGER_REFRESH_FLAG) === '1') {
          needsRefresh = true;
          sessionStorage.removeItem(TURN_MANAGER_REFRESH_FLAG);
        }
      } catch (_) {}

      if (needsRefresh) {
        window.location.reload();
        return;
      }

      try {
        if (document.referrer && document.referrer.includes('/settings')) {
          fetchImpl('/api/admin/unverify', {
            method: 'POST',
            credentials: 'include',
            headers: withClientUserHeader({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ scope: 'settings' }),
            keepalive: true,
          }).then(async (resp) => {
            const data = await resp.json().catch(() => ({}));
            if (data && isSessionGuardReason(data.reason)) triggerSessionMismatchReload();
          }).catch(() => {});
        }
      } catch (_) {}
    });

    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        const elapsed = now - lastHiddenAt;
        if (elapsed > STALE_REFRESH_MS) {
          forceRefreshFromServer();
        } else {
          checkForSessionMismatch();
        }
      } else if (document.visibilityState === 'hidden') {
        lastHiddenAt = Date.now();
      }
    });
    window.addEventListener('focus', checkForSessionMismatch);
  }

  initialize();

  return {
    loadInitialBoardState,
    startBoardRealtime,
    stopRealtime,
    queueBoardAction,
    applyServerBoardPayload: applyNormalizedBoardPayload,
    getBoardVersion: () => boardVersion,
  };
}

const TurnManagerBoardStream = { createBoardStream };

if (typeof window !== 'undefined') {
  window.TurnManagerBoardStream = Object.freeze({
    ...(window.TurnManagerBoardStream || {}),
    createBoardStream,
  });
}

export default TurnManagerBoardStream;
