import test from 'node:test';
import assert from 'node:assert/strict';

import { createBoardStream } from '../src/engine/board-stream.js';

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
}

function installWindow({ userId = 7 } = {}) {
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    EventSource: globalThis.EventSource,
  };
  const storage = new MemoryStorage();
  const listeners = new Map();
  const windowRef = {
    CURRENT_USER_ID: userId,
    USER_IS_LOGGED_IN: true,
    localStorage: storage,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    dispatchEvent() {},
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    location: {
      pathname: '/dashboard',
      search: '',
      href: 'https://example.com/dashboard',
      replace() {},
    },
  };
  globalThis.window = windowRef;
  globalThis.document = { visibilityState: 'visible' };
  globalThis.localStorage = storage;
  return {
    storage,
    listeners,
    teardown() {
      globalThis.window = previous.window;
      globalThis.document = previous.document;
      globalThis.localStorage = previous.localStorage;
      globalThis.EventSource = previous.EventSource;
    },
  };
}

test('board stream writes carry the tab load-day board date even for forced saves', async () => {
  const { teardown } = installWindow();
  let currentDateKey = '2026-04-26';
  const calls = [];
  const stream = createBoardStream({
    getTechnicians: () => [{ name: 'Kit', boxes: [] }],
    getSignInPool: () => ['Anya'],
    getBoxCount: () => 14,
    getCheckoutHistory: () => [],
    getBoardDateKey: () => currentDateKey,
    writeBoardCache: () => {},
    readBoardCache: () => null,
    mergeServerBoardPayload: (payload, fallbackVersion = 0) => {
      if (!payload?.board) return null;
      return {
        board: payload.board,
        version: Number.isFinite(payload.version) ? payload.version : fallbackVersion,
        boardDate: payload.boardDate || payload.board.boardDate || '',
      };
    },
    shouldQueueRemoteBoard: () => false,
    makeBoardStorageKey: (prefix, user) => `${prefix}:${user}`,
    fetchImpl: async (url, opts = {}) => {
      calls.push({
        url,
        method: opts.method || 'GET',
        body: opts.body ? JSON.parse(opts.body) : null,
      });
      return {
        ok: true,
        json: async () => ({ ok: true, version: 2, boardDate: '2026-04-27' }),
      };
    },
  });

  try {
    currentDateKey = '2026-04-27';
    stream.queueBoardAction('update_turn', { force: true });
    await new Promise((resolve) => setTimeout(resolve, 320));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/turns/update');
    assert.equal(calls[0].body.force, true);
    assert.equal(calls[0].body.boardDate, '2026-04-26');
    assert.equal(calls[0].body.board.boardDate, '2026-04-26');
    assert.equal(calls[0].body.timezoneOffset, new Date().getTimezoneOffset());
  } finally {
    teardown();
  }
});

test('board stream marks queue reset payloads so callers can skip stale queue reconciliation', () => {
  const { teardown } = installWindow();
  const contexts = [];
  const stream = createBoardStream({
    getTechnicians: () => [],
    setTechnicians: () => {},
    getSignInPool: () => [],
    setSignInPool: () => {},
    getSignInPoolDefault: () => ['Kit'],
    getBoxCount: () => 20,
    getCheckoutHistory: () => [],
    syncCheckoutHistoryFromBoard: () => {},
    renderTechGrid: () => {},
    renderAvailableList: () => {},
    updateGlobalActionButtons: () => {},
    writeBoardCache: () => {},
    readBoardCache: () => null,
    mergeServerBoardPayload: (payload, fallbackVersion = 0) => ({
      board: payload.board,
      version: Number.isFinite(payload.version) ? payload.version : fallbackVersion,
      boardDate: payload.boardDate || '',
    }),
    shouldQueueRemoteBoard: () => false,
    makeBoardStorageKey: (prefix, user) => `${prefix}:${user}`,
    onBoardApplied: (_board, context) => contexts.push(context),
  });

  try {
    stream.applyServerBoardPayload({
      board: {
        signInPool: ['Kit'],
        technicians: [],
        boxCount: 20,
        checkoutHistory: [],
      },
      version: 5,
      queueReset: true,
    }, { authoritative: true });

    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].skipQueueAutoSync, true);
  } finally {
    teardown();
  }
});

test('authoritative board payload cancels a queued local save retry', async () => {
  const { teardown } = installWindow();
  const calls = [];
  const technicians = [
    {
      name: 'Kit',
      boxes: [{ customer: 'Juniper', queueEntryId: 42 }],
    },
  ];
  const stream = createBoardStream({
    getTechnicians: () => technicians,
    setTechnicians: (next) => {
      technicians.splice(0, technicians.length, ...next);
    },
    getSignInPool: () => [],
    setSignInPool: () => {},
    getSignInPoolDefault: () => [],
    getBoxCount: () => 1,
    getCheckoutHistory: () => [],
    syncCheckoutHistoryFromBoard: () => {},
    writeBoardCache: () => {},
    readBoardCache: () => null,
    mergeServerBoardPayload: (payload, fallbackVersion = 0) => {
      if (!payload?.board) return null;
      return {
        board: payload.board,
        version: Number.isFinite(payload.version) ? payload.version : fallbackVersion,
        boardDate: payload.boardDate || payload.board.boardDate || '',
      };
    },
    shouldQueueRemoteBoard: ({ hasDirtyChanges, saveInFlight }) => Boolean(hasDirtyChanges || saveInFlight),
    makeBoardStorageKey: (prefix, user) => `${prefix}:${user}`,
    fetchImpl: async (url, opts = {}) => {
      calls.push({
        url,
        method: opts.method || 'GET',
        body: opts.body ? JSON.parse(opts.body) : null,
      });
      return {
        ok: true,
        json: async () => ({ ok: true, version: 2 }),
      };
    },
  });

  try {
    stream.queueBoardAction('update_turn');
    stream.applyServerBoardPayload({
      board: {
        technicians: [{ name: 'Kit', boxes: [null] }],
        signInPool: [],
        boxCount: 1,
        checkoutHistory: [],
      },
      version: 3,
    }, { authoritative: true });

    await new Promise((resolve) => setTimeout(resolve, 320));

    assert.equal(calls.length, 0);
    assert.deepEqual(technicians[0].boxes, [null]);
  } finally {
    teardown();
  }
});

test('stopping board realtime cancels a queued account-bound save', async () => {
  const { teardown } = installWindow();
  const calls = [];
  const stream = createBoardStream({
    getTechnicians: () => [{ name: 'Kit', boxes: [] }],
    getSignInPool: () => [],
    getBoxCount: () => 14,
    getCheckoutHistory: () => [],
    writeBoardCache: () => {},
    readBoardCache: () => null,
    mergeServerBoardPayload: () => null,
    shouldQueueRemoteBoard: () => false,
    makeBoardStorageKey: (prefix, user) => `${prefix}:${user}`,
    fetchImpl: async (...args) => {
      calls.push(args);
      return { ok: true, json: async () => ({ ok: true, version: 1 }) };
    },
  });

  try {
    stream.queueBoardAction('update_turn');
    stream.stopRealtime();
    await new Promise((resolve) => setTimeout(resolve, 320));

    assert.equal(calls.length, 0, 'pending board writes must be cancelled when the account changes');
  } finally {
    teardown();
  }
});

test('live board stream still polls for missed cross-process updates', async () => {
  const { teardown } = installWindow();
  const calls = [];
  const technicians = [
    {
      name: 'Kit',
      boxes: [{ customer: 'Juniper', queueEntryId: 42 }],
    },
  ];
  const eventSources = [];

  globalThis.EventSource = class MockEventSource {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      eventSources.push(this);
    }
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    }
    emit(type, data = {}) {
      const handler = this.listeners.get(type);
      if (handler) handler(data);
    }
    close() {}
  };

  const stream = createBoardStream({
    getTechnicians: () => technicians,
    setTechnicians: (next) => {
      technicians.splice(0, technicians.length, ...next);
    },
    getSignInPool: () => [],
    setSignInPool: () => {},
    getSignInPoolDefault: () => [],
    getBoxCount: () => 1,
    getCheckoutHistory: () => [],
    syncCheckoutHistoryFromBoard: () => {},
    writeBoardCache: () => {},
    readBoardCache: () => null,
    mergeServerBoardPayload: (payload, fallbackVersion = 0) => {
      if (!payload?.board) return null;
      return {
        board: payload.board,
        version: Number.isFinite(payload.version) ? payload.version : fallbackVersion,
        boardDate: payload.boardDate || payload.board.boardDate || '',
      };
    },
    shouldQueueRemoteBoard: ({ hasDirtyChanges, saveInFlight }) => Boolean(hasDirtyChanges || saveInFlight),
    makeBoardStorageKey: (prefix, user) => `${prefix}:${user}`,
    liveConsistencyPollIntervalMs: 20,
    fetchImpl: async (url, opts = {}) => {
      calls.push({
        url,
        method: opts.method || 'GET',
      });
      return {
        ok: true,
        json: async () => ({
          ok: true,
          version: 2,
          board: {
            technicians: [{ name: 'Kit', boxes: [null] }],
            signInPool: [],
            boxCount: 1,
            checkoutHistory: [],
          },
        }),
      };
    },
  });

  try {
    stream.applyServerBoardPayload({
      board: {
        technicians: [{ name: 'Kit', boxes: [{ customer: 'Juniper', queueEntryId: 42 }] }],
        signInPool: [],
        boxCount: 1,
        checkoutHistory: [],
      },
      version: 1,
    }, { authoritative: true });
    stream.startBoardRealtime();
    assert.equal(eventSources.length, 1);
    eventSources[0].emit('open');

    await new Promise((resolve) => setTimeout(resolve, 70));

    assert.ok(calls.some((call) => (
      call.url.startsWith('/api/board?')
      && !call.url.includes('since=')
    )));
    assert.deepEqual(technicians[0].boxes, [null]);
  } finally {
    teardown();
  }
});

test('live board consistency poll repairs a stale board even when the local version matches', async () => {
  const { teardown } = installWindow();
  const calls = [];
  const technicians = [
    {
      name: 'Kit',
      boxes: [{ customer: 'Juniper', queueEntryId: 42 }],
    },
  ];
  const eventSources = [];

  globalThis.EventSource = class MockEventSource {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      eventSources.push(this);
    }
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    }
    emit(type, data = {}) {
      const handler = this.listeners.get(type);
      if (handler) handler(data);
    }
    close() {}
  };

  const stream = createBoardStream({
    getTechnicians: () => technicians,
    setTechnicians: (next) => {
      technicians.splice(0, technicians.length, ...next);
    },
    getSignInPool: () => [],
    setSignInPool: () => {},
    getSignInPoolDefault: () => [],
    getBoxCount: () => 1,
    getCheckoutHistory: () => [],
    syncCheckoutHistoryFromBoard: () => {},
    writeBoardCache: () => {},
    readBoardCache: () => null,
    mergeServerBoardPayload: (payload, fallbackVersion = 0) => {
      if (!payload?.board) return null;
      return {
        board: payload.board,
        version: Number.isFinite(payload.version) ? payload.version : fallbackVersion,
        boardDate: payload.boardDate || payload.board.boardDate || '',
      };
    },
    shouldQueueRemoteBoard: ({ hasDirtyChanges, saveInFlight }) => Boolean(hasDirtyChanges || saveInFlight),
    makeBoardStorageKey: (prefix, user) => `${prefix}:${user}`,
    liveConsistencyPollIntervalMs: 20,
    fetchImpl: async (url, opts = {}) => {
      calls.push({
        url,
        method: opts.method || 'GET',
      });
      if (url.includes('since=2')) {
        return {
          status: 204,
          ok: true,
          json: async () => null,
        };
      }
      return {
        ok: true,
        json: async () => ({
          ok: true,
          version: 2,
          board: {
            technicians: [{ name: 'Kit', boxes: [null] }],
            signInPool: [],
            boxCount: 1,
            checkoutHistory: [],
          },
        }),
      };
    },
  });

  try {
    stream.applyServerBoardPayload({
      board: {
        technicians: [{ name: 'Kit', boxes: [{ customer: 'Juniper', queueEntryId: 42 }] }],
        signInPool: [],
        boxCount: 1,
        checkoutHistory: [],
      },
      version: 2,
    }, { authoritative: true });
    stream.startBoardRealtime();
    assert.equal(eventSources.length, 1);
    eventSources[0].emit('open');

    await new Promise((resolve) => setTimeout(resolve, 70));

    assert.ok(calls.some((call) => call.url.startsWith('/api/board?')));
    assert.deepEqual(technicians[0].boxes, [null]);
  } finally {
    teardown();
  }
});

test('board stream applies same-version server board queued during a local save', async () => {
  const { teardown } = installWindow();
  const calls = [];
  const technicians = [
    {
      name: 'Kit',
      boxes: [{ customer: 'Juniper', queueEntryId: 42 }],
    },
  ];
  const eventSources = [];
  let saveStartedResolve;
  const saveStarted = new Promise((resolve) => {
    saveStartedResolve = resolve;
  });
  let finishSaveResolve;
  const finishSave = new Promise((resolve) => {
    finishSaveResolve = resolve;
  });

  globalThis.EventSource = class MockEventSource {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      eventSources.push(this);
    }
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    }
    emit(type, data = {}) {
      const handler = this.listeners.get(type);
      if (handler) handler(data);
    }
    close() {}
  };

  const stream = createBoardStream({
    getTechnicians: () => technicians,
    setTechnicians: (next) => {
      technicians.splice(0, technicians.length, ...next);
    },
    getSignInPool: () => [],
    setSignInPool: () => {},
    getSignInPoolDefault: () => [],
    getBoxCount: () => 1,
    getCheckoutHistory: () => [],
    syncCheckoutHistoryFromBoard: () => {},
    writeBoardCache: () => {},
    readBoardCache: () => null,
    mergeServerBoardPayload: (payload, fallbackVersion = 0) => {
      if (!payload?.board) return null;
      return {
        board: payload.board,
        version: Number.isFinite(payload.version) ? payload.version : fallbackVersion,
        boardDate: payload.boardDate || payload.board.boardDate || '',
      };
    },
    shouldQueueRemoteBoard: ({ hasDirtyChanges, saveInFlight }) => Boolean(hasDirtyChanges || saveInFlight),
    makeBoardStorageKey: (prefix, user) => `${prefix}:${user}`,
    fetchImpl: async (url, opts = {}) => {
      calls.push({
        url,
        method: opts.method || 'GET',
        body: opts.body ? JSON.parse(opts.body) : null,
      });
      saveStartedResolve();
      await finishSave;
      return {
        ok: true,
        json: async () => ({
          ok: true,
          version: 2,
          boardDate: '2026-04-26',
        }),
      };
    },
  });

  try {
    stream.applyServerBoardPayload({
      board: {
        technicians: [{ name: 'Kit', boxes: [{ customer: 'Juniper', queueEntryId: 42 }] }],
        signInPool: [],
        boxCount: 1,
        checkoutHistory: [],
      },
      version: 1,
      boardDate: '2026-04-26',
    }, { authoritative: true });
    stream.startBoardRealtime();
    assert.equal(eventSources.length, 1);
    eventSources[0].emit('open');

    stream.queueBoardAction('update_turn');
    await saveStarted;
    eventSources[0].emit('board', {
      data: JSON.stringify({
        version: 2,
        boardDate: '2026-04-26',
        board: {
          technicians: [{ name: 'Kit', boxes: [null] }],
          signInPool: [],
          boxCount: 1,
          checkoutHistory: [],
        },
      }),
    });
    assert.deepEqual(technicians[0].boxes, [{ customer: 'Juniper', queueEntryId: 42 }]);
    finishSaveResolve();
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.equal(calls.length, 1);
    assert.deepEqual(technicians[0].boxes, [null]);
  } finally {
    teardown();
  }
});
