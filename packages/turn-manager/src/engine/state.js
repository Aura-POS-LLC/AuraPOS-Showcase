/**
 * Shared state store for the Turn Manager UI.
 * Provides a simple pub/sub interface with immutable snapshots.
 */

const DEFAULT_STATE = {
  showAllAvailable: false,
  serviceFilterValue: 'ALL',
  sidebarCollapsed: false,
  queueEntries: [],
  queueServiceCompletion: {}, // { entryId: [indexes...] }
  checkoutHistory: [],
};

// Defensive clones so subscribers can't mutate internal state.
function cloneQueueEntries(list) {
  return Array.isArray(list) ? list.map(item => ({ ...item })) : [];
}

function cloneCompletionMap(mapLike) {
  if (!mapLike || typeof mapLike !== 'object') return {};
  const result = {};
  Object.entries(mapLike).forEach(([key, value]) => {
    if (!key) return;
    if (Array.isArray(value)) {
      result[key] = value.filter(v => Number.isInteger(v)).map(v => Number(v));
    } else if (value instanceof Set) {
      result[key] = Array.from(value).filter(v => Number.isInteger(v)).map(v => Number(v));
    }
  });
  return result;
}

function cloneCheckoutHistory(list) {
  return Array.isArray(list) ? list.map(item => ({ ...item })) : [];
}

function createTurnManagerStore(initialState = {}) {
  let state = {
    ...DEFAULT_STATE,
    ...initialState,
    queueEntries: cloneQueueEntries(initialState.queueEntries),
    queueServiceCompletion: cloneCompletionMap(initialState.queueServiceCompletion),
    checkoutHistory: cloneCheckoutHistory(initialState.checkoutHistory),
  };

  const listeners = new Set();

  function emit() {
    const snapshot = getState();
    listeners.forEach(listener => {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('TurnManagerStore listener failed', err);
      }
    });
  }

  function getState() {
    return {
      ...state,
      queueEntries: cloneQueueEntries(state.queueEntries),
      queueServiceCompletion: cloneCompletionMap(state.queueServiceCompletion),
      checkoutHistory: cloneCheckoutHistory(state.checkoutHistory),
    };
  }

  function update(partial) {
    state = { ...state, ...partial };
    emit();
    return getState();
  }

  const actions = {
    setShowAllAvailable(value) {
      state = { ...state, showAllAvailable: !!value };
      emit();
      return state.showAllAvailable;
    },
    setServiceFilterValue(value) {
      const next = typeof value === 'string' && value.trim().length ? value.trim() : 'ALL';
      state = { ...state, serviceFilterValue: next };
      emit();
      return state.serviceFilterValue;
    },
    setSidebarCollapsed(value) {
      state = { ...state, sidebarCollapsed: !!value };
      emit();
      return state.sidebarCollapsed;
    },
    setQueueEntries(list) {
      state = { ...state, queueEntries: cloneQueueEntries(list) };
      emit();
      return cloneQueueEntries(state.queueEntries);
    },
    updateQueueEntry(entry) {
      if (!entry || entry.id === undefined || entry.id === null) return cloneQueueEntries(state.queueEntries);
      const targetId = String(entry.id);
      const next = state.queueEntries.map(item => (String(item?.id) === targetId ? { ...item, ...entry } : item));
      state = { ...state, queueEntries: next };
      emit();
      return cloneQueueEntries(state.queueEntries);
    },
    removeQueueEntry(entryId) {
      const targetId = String(entryId);
      const next = state.queueEntries.filter(item => String(item?.id) !== targetId);
      const completion = { ...state.queueServiceCompletion };
      delete completion[targetId];
      state = { ...state, queueEntries: next, queueServiceCompletion: completion };
      emit();
      return cloneQueueEntries(state.queueEntries);
    },
    toggleQueueServiceCompletion(entryId, serviceIndex) {
      const key = String(entryId);
      const current = new Set(state.queueServiceCompletion[key] || []);
      if (current.has(serviceIndex)) {
        current.delete(serviceIndex);
      } else {
        current.add(serviceIndex);
      }
      const completion = { ...state.queueServiceCompletion };
      if (current.size) {
        completion[key] = Array.from(current);
      } else {
        delete completion[key];
      }
      state = { ...state, queueServiceCompletion: completion };
      emit();
      return new Set(current);
    },
    getQueueServiceCompletion(entryId) {
      const key = String(entryId);
      return new Set(state.queueServiceCompletion[key] || []);
    },
    clearQueueServiceCompletion(entryId) {
      const key = String(entryId);
      if (!key || !(key in state.queueServiceCompletion)) return;
      const completion = { ...state.queueServiceCompletion };
      delete completion[key];
      state = { ...state, queueServiceCompletion: completion };
      emit();
    },
    setCheckoutHistory(list) {
      state = { ...state, checkoutHistory: cloneCheckoutHistory(list) };
      emit();
      return cloneCheckoutHistory(state.checkoutHistory);
    },
  };

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { getState, subscribe, actions };
}

const defaultStore = createTurnManagerStore();

export function getDefaultTurnManagerStore() {
  return defaultStore;
}

const TurnManagerEngineState = {
  DEFAULT_STATE,
  createStore: createTurnManagerStore,
  getStore: () => defaultStore,
};

if (typeof window !== 'undefined') {
  window.TurnManagerEngineState = Object.freeze({
    ...(window.TurnManagerEngineState || {}),
    DEFAULT_STATE,
    createStore: createTurnManagerStore,
    getStore: () => defaultStore,
  });
}

export default TurnManagerEngineState;
