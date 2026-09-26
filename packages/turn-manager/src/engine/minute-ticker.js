/**
 * Periodically refreshes live Turn Manager timer text.
 */

export function createMinuteTicker(options = {}) {
  const {
    getTechnicians = () => [],
    renderTechGrid = () => {},
    updateTechTimers = null,
    renderAvailableList = () => {},
    updateGlobalActionButtons = () => {},
    shouldRenderAvailableList = null,
  } = options;

  let timer = null;

  function tick() {
    const technicians = getTechnicians();
    const anyActive = technicians.some(t => (t.boxes || []).some(b => b && b.status === 'working' && b.startAt));
    const shouldRenderAvailable = typeof shouldRenderAvailableList === 'function'
      ? shouldRenderAvailableList()
      : false;
    if (anyActive) {
      if (typeof updateTechTimers === 'function') {
        updateTechTimers();
      } else {
        renderTechGrid();
      }
      updateGlobalActionButtons();
    }
    if (shouldRenderAvailable) {
      renderAvailableList(true);
    }
  }

  function start(intervalMs = 60000) {
    stop();
    timer = setInterval(tick, intervalMs);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop };
}

const TurnManagerMinuteTicker = { createMinuteTicker };

if (typeof window !== 'undefined') {
  window.TurnManagerMinuteTicker = Object.freeze({
    ...(window.TurnManagerMinuteTicker || {}),
    createMinuteTicker,
  });
}

export default TurnManagerMinuteTicker;
