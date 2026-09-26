import test from 'node:test';
import assert from 'node:assert/strict';

import { createMinuteTicker } from '../src/engine/minute-ticker.js';

function withCapturedInterval(runTest) {
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  let capturedTick = null;

  global.setInterval = (fn) => {
    capturedTick = fn;
    return 101;
  };
  global.clearInterval = () => {};

  try {
    return runTest(() => capturedTick);
  } finally {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  }
}

test('minute ticker updates timer text without full board render when updater is available', () => {
  withCapturedInterval((getCapturedTick) => {
    let renderCalls = 0;
    let timerCalls = 0;
    let availableCalls = 0;
    let actionCalls = 0;
    const ticker = createMinuteTicker({
      getTechnicians: () => [{ boxes: [{ status: 'working', startAt: Date.now() }] }],
      renderTechGrid: () => { renderCalls += 1; },
      updateTechTimers: () => { timerCalls += 1; },
      renderAvailableList: () => { availableCalls += 1; },
      updateGlobalActionButtons: () => { actionCalls += 1; },
      shouldRenderAvailableList: () => false,
    });

    ticker.start(60000);
    getCapturedTick()();

    assert.equal(renderCalls, 0);
    assert.equal(timerCalls, 1);
    assert.equal(availableCalls, 0);
    assert.equal(actionCalls, 1);
  });
});

test('minute ticker keeps full board render fallback when timer updater is unavailable', () => {
  withCapturedInterval((getCapturedTick) => {
    let renderCalls = 0;
    let availableCalls = 0;
    const ticker = createMinuteTicker({
      getTechnicians: () => [{ boxes: [{ status: 'working', startAt: Date.now() }] }],
      renderTechGrid: () => { renderCalls += 1; },
      renderAvailableList: () => { availableCalls += 1; },
      shouldRenderAvailableList: () => false,
    });

    ticker.start(60000);
    getCapturedTick()();

    assert.equal(renderCalls, 1);
    assert.equal(availableCalls, 0);
  });
});
