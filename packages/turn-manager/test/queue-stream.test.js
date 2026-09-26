import test from 'node:test';
import assert from 'node:assert/strict';

import { createQueueStream } from '../src/engine/queue-stream.js';

test('queue stream falls back to poller when SSE errors persist', async () => {
  const originalEventSource = globalThis.EventSource;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;

  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.handlers = {};
      FakeEventSource.instances.push(this);
    }
    addEventListener(type, handler) {
      this.handlers[type] = handler;
    }
    close() {
      this.closed = true;
    }
  }
  FakeEventSource.instances = [];

  const intervals = [];
  globalThis.EventSource = FakeEventSource;
  globalThis.setInterval = (fn) => {
    intervals.push(fn);
    fn();
    return { id: intervals.length };
  };
  globalThis.clearInterval = () => {};

  let lastQueue = null;
  const stream = createQueueStream({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ items: [{ id: 1 }] }),
    }),
    setQueueEntries: (items) => { lastQueue = items; },
    handleQueueStreamError: () => ({ nextCount: 5, shouldFallback: true, delay: 0 }),
    onError: () => {},
    onSuccess: () => {},
  });

  try {
    stream.startRealtime();
    assert.equal(FakeEventSource.instances.length, 1);
    const instance = FakeEventSource.instances[0];
    assert.ok(typeof instance.handlers.error === 'function');
    instance.handlers.error();
    assert.ok(instance.closed);
    assert.ok(intervals.length >= 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(Array.isArray(lastQueue));
  } finally {
    stream.stopRealtime();
    globalThis.EventSource = originalEventSource;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test('queue stream applies customer_queue_delta events without full reload', async () => {
  const originalEventSource = globalThis.EventSource;

  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.handlers = {};
      FakeEventSource.instances.push(this);
    }
    addEventListener(type, handler) {
      this.handlers[type] = handler;
    }
    close() {
      this.closed = true;
    }
  }
  FakeEventSource.instances = [];
  globalThis.EventSource = FakeEventSource;

  const updates = [];
  const stream = createQueueStream({
    fetchImpl: async () => {
      throw new Error('delta event should not fetch the full queue');
    },
    setQueueEntries: (items) => { updates.push(items); },
    handleQueueStreamError: () => ({ nextCount: 1, shouldFallback: false, delay: 0 }),
    onError: () => {},
    onSuccess: () => {},
  });

  try {
    stream.startRealtime();
    const sourceObj = FakeEventSource.instances[0];
    assert.match(sourceObj.url, /queue_delta=1/, 'queue stream should advertise delta support');
    sourceObj.handlers.customer_queue?.({
      data: JSON.stringify({
        items: [{ id: 1, name: 'Moe' }, { id: 2, name: 'Lux' }],
        queueVersion: 'queue-v1',
      }),
    });
    sourceObj.handlers.customer_queue_delta?.({
      data: JSON.stringify({
        items: [{ id: 2, name: 'Lux Updated' }, { id: 3, name: 'Kit' }],
        removedIds: [1],
        queueVersion: 'queue-v2',
      }),
    });

    assert.deepEqual(updates.at(-1), [
      { id: 2, name: 'Lux Updated' },
      { id: 3, name: 'Kit' },
    ]);
  } finally {
    stream.stopRealtime();
    globalThis.EventSource = originalEventSource;
  }
});

test('queue stream delegates to queue controller when provided', async () => {
  const updates = [];
  const controller = {
    subscribers: new Set(),
    refreshCount: 0,
    startStreamCalled: false,
    stopStreamCalled: false,
    unsubscribed: false,
    async refresh() {
      this.refreshCount += 1;
      const payload = [{ id: this.refreshCount }];
      this.subscribers.forEach(cb => cb(payload));
      return payload;
    },
    subscribe(fn) {
      this.subscribers.add(fn);
      return () => {
        this.subscribers.delete(fn);
        this.unsubscribed = true;
      };
    },
    startStream() {
      this.startStreamCalled = true;
    },
    stopStream() {
      this.stopStreamCalled = true;
    },
  };

  const stream = createQueueStream({
    queueController: controller,
    setQueueEntries: (items) => updates.push(items),
    handleQueueStreamError: () => ({ nextCount: 1, shouldFallback: false, delay: 0 }),
    onError: () => {},
    onSuccess: () => {},
  });

  stream.startRealtime();
  assert.equal(controller.startStreamCalled, true);
  await stream.refresh();
  assert.ok(updates.length >= 1);
  stream.stopRealtime();
  assert.equal(controller.stopStreamCalled, true);
  assert.equal(controller.unsubscribed, true);
});

test('queue stream applySnapshot updates controller-backed cached entries', () => {
  const updates = [];
  const metadataSeen = [];
  const controller = {
    setEntries(items, metadata) {
      metadataSeen.push(metadata);
      return Array.isArray(items) ? items.map((item) => ({ ...item })) : [];
    },
  };
  const stream = createQueueStream({
    queueController: controller,
    setQueueEntries: (items) => updates.push(items),
    handleQueueStreamError: () => ({ nextCount: 1, shouldFallback: false, delay: 0 }),
    onError: () => {},
    onSuccess: () => {},
  });

  const result = stream.applySnapshot([], { queueVersion: 'qfactive|qc0|qi0|qunone' });

  assert.deepEqual(result, []);
  assert.deepEqual(updates.at(-1), []);
  assert.equal(metadataSeen.at(-1).queueVersion, 'qfactive|qc0|qi0|qunone');
});

test('queue stream polls while controller stream is live for missed cross-process updates', async () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const intervals = [];
  const updates = [];
  let openHandler = null;
  let refreshCount = 0;
  const controller = {
    async refresh({ force } = {}) {
      refreshCount += 1;
      return [{ id: refreshCount, force: force === true }];
    },
    subscribe() {
      return () => {};
    },
    startStream(handlers = {}) {
      openHandler = handlers.onOpen;
    },
    stopStream() {},
  };

  globalThis.setInterval = (fn, delay) => {
    intervals.push({ fn, delay });
    return { id: intervals.length };
  };
  globalThis.clearInterval = () => {};

  const stream = createQueueStream({
    queueController: controller,
    setQueueEntries: (items) => updates.push(items),
    handleQueueStreamError: () => ({ nextCount: 1, shouldFallback: false, delay: 0 }),
    liveConsistencyPollIntervalMs: 25,
    onError: () => {},
    onSuccess: () => {},
  });

  try {
    stream.startRealtime();
    assert.equal(typeof openHandler, 'function');
    openHandler();

    assert.ok(intervals.some((timer) => timer.delay === 25));
    const liveTimer = intervals.find((timer) => timer.delay === 25);
    liveTimer.fn();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(updates.at(-1), [{ id: 2, force: false }]);
  } finally {
    stream.stopRealtime();
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test('queue stream handles session mismatch event by stopping realtime', async () => {
  const originalEventSource = globalThis.EventSource;
  class FakeEventSource {
    constructor() {
      this.handlers = {};
      this.closed = false;
      FakeEventSource.instances.push(this);
    }
    addEventListener(type, handler) {
      this.handlers[type] = handler;
    }
    close() {
      this.closed = true;
    }
  }
  FakeEventSource.instances = [];
  globalThis.EventSource = FakeEventSource;
  let mismatchCalls = 0;
  const stream = createQueueStream({
    fetchImpl: async () => ({ ok: true, json: async () => ({ items: [] }) }),
    setQueueEntries: () => {},
    handleQueueStreamError: () => ({ nextCount: 1, shouldFallback: false, delay: 5000 }),
    handleSessionMismatch: () => { mismatchCalls += 1; },
    onError: () => {},
    onSuccess: () => {},
  });

  try {
    stream.startRealtime();
    assert.equal(FakeEventSource.instances.length, 1);
    const sourceObj = FakeEventSource.instances[0];
    sourceObj.handlers.session?.({ data: JSON.stringify({ reason: 'session_mismatch' }) });
    assert.equal(mismatchCalls, 1);
    assert.equal(sourceObj.closed, true);
  } finally {
    stream.stopRealtime();
    globalThis.EventSource = originalEventSource;
  }
});

test('queue stream handles session_rotated event by stopping realtime', async () => {
  const originalEventSource = globalThis.EventSource;
  class FakeEventSource {
    constructor() {
      this.handlers = {};
      this.closed = false;
      FakeEventSource.instances.push(this);
    }
    addEventListener(type, handler) {
      this.handlers[type] = handler;
    }
    close() {
      this.closed = true;
    }
  }
  FakeEventSource.instances = [];
  globalThis.EventSource = FakeEventSource;
  let mismatchCalls = 0;
  const stream = createQueueStream({
    fetchImpl: async () => ({ ok: true, json: async () => ({ items: [] }) }),
    setQueueEntries: () => {},
    handleQueueStreamError: () => ({ nextCount: 1, shouldFallback: false, delay: 5000 }),
    handleSessionMismatch: () => { mismatchCalls += 1; },
    onError: () => {},
    onSuccess: () => {},
  });

  try {
    stream.startRealtime();
    assert.equal(FakeEventSource.instances.length, 1);
    const sourceObj = FakeEventSource.instances[0];
    sourceObj.handlers.session?.({ data: JSON.stringify({ reason: 'session_rotated' }) });
    assert.equal(mismatchCalls, 1);
    assert.equal(sourceObj.closed, true);
  } finally {
    stream.stopRealtime();
    globalThis.EventSource = originalEventSource;
  }
});
