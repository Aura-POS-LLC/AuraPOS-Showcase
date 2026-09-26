import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCheckoutEventBus,
  createCheckoutEventEnvelope,
  normalizeCheckoutEventBusMode,
} from '../src/checkout-event-bus.js';

class FakeRedisBroker {
  constructor() {
    this.subscribers = [];
  }

  subscribe(pattern, cb) {
    this.subscribers.push({ pattern, cb });
  }

  publish(channel, message) {
    this.subscribers.forEach((subscriber) => {
      if (!this.matches(subscriber.pattern, channel)) return;
      subscriber.cb(message, channel);
    });
  }

  matches(pattern, channel) {
    if (!pattern.includes('*')) return pattern === channel;
    const [prefix] = pattern.split('*');
    return channel.startsWith(prefix);
  }
}

function createFakeRedisClients(broker) {
  const noop = () => {};
  return {
    publisher: {
      connect: async () => {},
      quit: async () => {},
      on: noop,
      publish: async (channel, message) => {
        broker.publish(channel, message);
        return 1;
      },
    },
    subscriber: {
      connect: async () => {},
      quit: async () => {},
      on: noop,
      pSubscribe: async (pattern, cb) => {
        broker.subscribe(pattern, cb);
      },
    },
  };
}

test('normalizeCheckoutEventBusMode defaults to memory for unknown values', () => {
  assert.equal(normalizeCheckoutEventBusMode('redis'), 'redis');
  assert.equal(normalizeCheckoutEventBusMode('memory'), 'memory');
  assert.equal(normalizeCheckoutEventBusMode('bogus'), 'memory');
});

test('createCheckoutEventEnvelope normalizes required fields', () => {
  const envelope = createCheckoutEventEnvelope({
    originInstanceId: 'instance-a',
    userId: '9',
    locationId: 'loc-1',
    version: 12.9,
    updatedAt: '2026-03-20T00:00:00.000Z',
    payload: { ok: true },
  });
  assert.ok(envelope);
  assert.equal(envelope.userId, 9);
  assert.equal(envelope.locationId, 'loc-1');
  assert.equal(envelope.version, 12);
  assert.equal(envelope.originInstanceId, 'instance-a');
  assert.equal(typeof envelope.eventId, 'string');
});

test('redis event bus dispatches cross-instance events and suppresses self-origin events', async () => {
  const broker = new FakeRedisBroker();

  const busA = createCheckoutEventBus({
    mode: 'redis',
    instanceId: 'instance-a',
    channelPrefix: 'checkout:tickets',
    redisClientsFactory: async () => createFakeRedisClients(broker),
    logger: { warn: () => {} },
  });
  const busB = createCheckoutEventBus({
    mode: 'redis',
    instanceId: 'instance-b',
    channelPrefix: 'checkout:tickets',
    redisClientsFactory: async () => createFakeRedisClients(broker),
    logger: { warn: () => {} },
  });

  const seenByA = [];
  const seenByB = [];
  busA.setEventHandler((event) => seenByA.push(event));
  busB.setEventHandler((event) => seenByB.push(event));

  await busA.start();
  await busB.start();

  await busA.publishCheckoutTickets({
    userId: 42,
    locationId: 'loc-42',
    version: 7,
    updatedAt: '2026-03-20T12:00:00.000Z',
    payload: { savedTickets: [], finishedTickets: [], voidedTickets: [], version: 7, updatedAt: '2026-03-20T12:00:00.000Z' },
  });

  assert.equal(seenByA.length, 0);
  assert.equal(seenByB.length, 1);
  assert.equal(seenByB[0].originInstanceId, 'instance-a');
  assert.equal(seenByB[0].userId, 42);
  assert.equal(seenByB[0].locationId, 'loc-42');

  await busA.stop();
  await busB.stop();
});

