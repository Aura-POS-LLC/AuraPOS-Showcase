import test from 'node:test';
import assert from 'node:assert/strict';

import TurnManagerState, { getDefaultTurnManagerStore } from '../src/engine/state.js';

test('default store toggles flags and service filter', () => {
  const store = getDefaultTurnManagerStore();
  store.actions.setShowAllAvailable(true);
  assert.equal(store.getState().showAllAvailable, true);
  store.actions.setServiceFilterValue('Pedicure');
  assert.equal(store.getState().serviceFilterValue, 'Pedicure');
  store.actions.setSidebarCollapsed(true);
  assert.equal(store.getState().sidebarCollapsed, true);
});

test('queue entry mutations update state immutably', () => {
  const store = TurnManagerState.createStore();
  store.actions.setQueueEntries([{ id: 1, name: 'Aster' }]);
  assert.equal(store.getState().queueEntries.length, 1);
  store.actions.updateQueueEntry({ id: 1, status: 'seated' });
  assert.equal(store.getState().queueEntries[0].status, 'seated');
  store.actions.toggleQueueServiceCompletion(1, 0);
  assert.equal(store.actions.getQueueServiceCompletion(1).has(0), true);
  store.actions.removeQueueEntry(1);
  assert.equal(store.getState().queueEntries.length, 0);
});

test('checkout history setter stores normalized entries', () => {
  const store = TurnManagerState.createStore();
  store.actions.setCheckoutHistory([
    { tech: 'Ida', service: 'Gel', completedAt: 1 },
    null,
  ]);
  const history = store.getState().checkoutHistory;
  assert.equal(history.length, 2);
  assert.equal(history[0].tech, 'Ida');
  assert.equal(history[1].tech, undefined);
});
