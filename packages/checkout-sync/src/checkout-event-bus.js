import crypto from 'crypto';

const EVENT_BUS_MODES = new Set(['memory', 'redis']);

function safeString(value, max = 240) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  if (!text) return '';
  return text.slice(0, Math.max(1, Math.trunc(max)));
}

function parseFinitePositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.trunc(parsed);
  return normalized > 0 ? normalized : null;
}

export function normalizeCheckoutEventBusMode(raw, fallback = 'memory') {
  const normalized = safeString(raw, 32).toLowerCase();
  if (EVENT_BUS_MODES.has(normalized)) return normalized;
  return EVENT_BUS_MODES.has(fallback) ? fallback : 'memory';
}

export function createCheckoutEventEnvelope({
  eventId = '',
  originInstanceId = '',
  userId = null,
  locationId = '',
  version = null,
  updatedAt = null,
  payload = null,
} = {}) {
  const normalizedUserId = parseFinitePositiveInt(userId);
  const normalizedLocationId = safeString(locationId, 64);
  if (!normalizedUserId || !normalizedLocationId) return null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const normalizedEventId = safeString(eventId, 160) || crypto.randomUUID();
  const normalizedOrigin = safeString(originInstanceId, 160);
  const parsedVersion = Number(version);
  const normalizedVersion = Number.isFinite(parsedVersion) ? Math.trunc(parsedVersion) : null;
  const normalizedUpdatedAt = safeString(updatedAt, 80);
  return {
    eventId: normalizedEventId,
    originInstanceId: normalizedOrigin || null,
    userId: normalizedUserId,
    locationId: normalizedLocationId,
    version: normalizedVersion,
    updatedAt: normalizedUpdatedAt || null,
    payload,
  };
}

function createRedisUrl({ redisUrl = '', redisHost = '', redisPort = 6379, redisPassword = '' } = {}) {
  const explicit = safeString(redisUrl, 1024);
  if (explicit) return explicit;
  const host = safeString(redisHost, 200);
  if (!host) return '';
  const parsedPort = Number(redisPort);
  const safePort = Number.isFinite(parsedPort) && parsedPort > 0 ? Math.trunc(parsedPort) : 6379;
  const encodedPassword = safeString(redisPassword, 400)
    ? `${encodeURIComponent(String(redisPassword))}@`
    : '';
  return `redis://${encodedPassword}${host}:${safePort}`;
}

function checkoutEventChannel(prefix, userId, locationId) {
  const normalizedPrefix = safeString(prefix, 160) || 'checkout:tickets';
  const normalizedUserId = parseFinitePositiveInt(userId);
  const normalizedLocationId = safeString(locationId, 64);
  if (!normalizedUserId || !normalizedLocationId) return null;
  return `${normalizedPrefix}:${normalizedUserId}:${normalizedLocationId}`;
}

function parseCheckoutEventFromMessage(message) {
  if (typeof message !== 'string' || !message.trim()) return null;
  try {
    const parsed = JSON.parse(message);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

export function createCheckoutEventBus({
  mode = 'memory',
  channelPrefix = 'checkout:tickets',
  instanceId = '',
  redisUrl = '',
  redisHost = '',
  redisPort = 6379,
  redisPassword = '',
  logger = console,
  redisClientsFactory = null,
} = {}) {
  const normalizedMode = normalizeCheckoutEventBusMode(mode);
  const normalizedChannelPrefix = safeString(channelPrefix, 160) || 'checkout:tickets';
  const normalizedInstanceId = safeString(instanceId, 160) || crypto.randomUUID();
  let eventHandler = null;
  let pubClient = null;
  let subClient = null;
  let started = false;
  let degraded = false;
  let lastError = '';

  const setDegraded = (flag, err = null) => {
    degraded = flag === true;
    lastError = degraded ? safeString(err?.message || err || 'checkout_event_bus_error', 500) : '';
  };

  const logWarn = (message, err = null) => {
    try {
      logger?.warn?.(message, err || '');
    } catch (_) {}
  };

  const getRedisClients = async () => {
    if (typeof redisClientsFactory === 'function') {
      const fromFactory = await redisClientsFactory();
      if (
        fromFactory
        && typeof fromFactory === 'object'
        && fromFactory.publisher
        && fromFactory.subscriber
      ) {
        return fromFactory;
      }
      return null;
    }
    const { createClient } = await import('redis');
    const url = createRedisUrl({ redisUrl, redisHost, redisPort, redisPassword });
    if (!url) return null;
    const publisher = createClient({ url });
    const subscriber = createClient({ url });
    return { publisher, subscriber };
  };

  const maybeDispatch = (envelope) => {
    if (!envelope || typeof envelope !== 'object') return;
    if (!eventHandler) return;
    const normalized = createCheckoutEventEnvelope(envelope);
    if (!normalized) return;
    if (
      normalized.originInstanceId
      && normalized.originInstanceId === normalizedInstanceId
    ) {
      return;
    }
    try {
      eventHandler(normalized);
    } catch (err) {
      logWarn('checkout_event_bus dispatch handler failed', err);
    }
  };

  const startRedis = async () => {
    const clients = await getRedisClients();
    if (!clients) {
      setDegraded(true, 'redis config missing');
      logWarn('checkout_event_bus redis mode enabled but no redis connection settings were provided');
      return;
    }
    pubClient = clients.publisher;
    subClient = clients.subscriber;

    const onError = (err) => {
      setDegraded(true, err);
      logWarn('checkout_event_bus redis error', err);
    };
    try { pubClient?.on?.('error', onError); } catch (_) {}
    try { subClient?.on?.('error', onError); } catch (_) {}

    await pubClient.connect();
    await subClient.connect();

    const pattern = `${normalizedChannelPrefix}:*:*`;
    await subClient.pSubscribe(pattern, (message) => {
      const parsed = parseCheckoutEventFromMessage(message);
      if (!parsed) return;
      maybeDispatch(parsed);
    });
    setDegraded(false);
  };

  return {
    get mode() {
      return normalizedMode;
    },
    get instanceId() {
      return normalizedInstanceId;
    },
    get channelPrefix() {
      return normalizedChannelPrefix;
    },
    get degraded() {
      return degraded;
    },
    get lastError() {
      return lastError;
    },
    setEventHandler(handler) {
      eventHandler = typeof handler === 'function' ? handler : null;
    },
    async start() {
      if (started) return;
      started = true;
      if (normalizedMode !== 'redis') return;
      try {
        await startRedis();
      } catch (err) {
        setDegraded(true, err);
        logWarn('checkout_event_bus failed to start redis transport; running fail-open', err);
      }
    },
    async stop() {
      started = false;
      try {
        await subClient?.quit?.();
      } catch (_) {}
      try {
        await pubClient?.quit?.();
      } catch (_) {}
      subClient = null;
      pubClient = null;
    },
    async publishCheckoutTickets({ userId, locationId, payload, version = null, updatedAt = null } = {}) {
      const envelope = createCheckoutEventEnvelope({
        originInstanceId: normalizedInstanceId,
        userId,
        locationId,
        version,
        updatedAt,
        payload,
      });
      if (!envelope) return null;
      if (normalizedMode !== 'redis') return envelope;
      const channel = checkoutEventChannel(normalizedChannelPrefix, userId, locationId);
      if (!channel) return envelope;
      if (!pubClient || !started) {
        setDegraded(true, 'redis_not_ready');
        return envelope;
      }
      try {
        await pubClient.publish(channel, JSON.stringify(envelope));
        setDegraded(false);
      } catch (err) {
        setDegraded(true, err);
        logWarn('checkout_event_bus publish failed; continuing fail-open', err);
      }
      return envelope;
    },
  };
}

