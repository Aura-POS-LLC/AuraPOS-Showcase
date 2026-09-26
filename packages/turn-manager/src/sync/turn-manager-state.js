import { skillNamesForTech } from './turn-manager-helpers.js';

function normalizeNameKey(value) {
  return String(value || '').trim().toLowerCase();
}

export function isActiveQueueEntryForBoardSync(entry) {
  const status = String(entry?.status || '').trim().toLowerCase();
  return status === 'waiting' || status === 'seated';
}

export function buildTechnicianRecord({ name, boxCount = 0, settings = {}, includeLateTurn = false, now = Date.now() }) {
  const count = Math.max(0, Number(boxCount) || 0);
  const boxes = Array(count).fill(null);
  const record = {
    name,
    boxes,
    checkInAt: now,
    skipped: false,
    skills: skillNamesForTech(name, settings),
  };
  if (includeLateTurn && boxes.length) {
    record.boxes[0] = {
      name: 'Late',
      turns: 1,
      status: 'scheduled',
      createdAt: now,
    };
  }
  return record;
}

export function signInTechnician(state, name, options = {}) {
  if (!name) return { ...state, inserted: null, appliedLateTurn: false };
  const technicians = Array.isArray(state?.technicians) ? state.technicians.slice() : [];
  const signInPool = Array.isArray(state?.signInPool) ? state.signInPool.filter(n => n !== name) : [];
  const record = buildTechnicianRecord({
    name,
    boxCount: options.boxCount,
    settings: options.settings,
    includeLateTurn: !!options.includeLateTurn,
    now: options.now || Date.now(),
  });
  technicians.push(record);
  return { technicians, signInPool, inserted: record, appliedLateTurn: !!options.includeLateTurn };
}

export function signOutTechnician(state, name, options = {}) {
  const targetKey = normalizeNameKey(name);
  if (!targetKey) {
    return {
      technicians: Array.isArray(state?.technicians) ? state.technicians.slice() : [],
      signInPool: Array.isArray(state?.signInPool) ? state.signInPool.slice() : [],
      removed: null,
    };
  }

  const technicians = Array.isArray(state?.technicians) ? state.technicians.slice() : [];
  const removeIndex = technicians.findIndex((tech) => normalizeNameKey(tech?.name) === targetKey);
  if (removeIndex === -1) {
    return {
      technicians,
      signInPool: Array.isArray(state?.signInPool) ? state.signInPool.slice() : [],
      removed: null,
    };
  }

  const [removed] = technicians.splice(removeIndex, 1);
  const existingPool = Array.isArray(state?.signInPool) ? state.signInPool.slice() : [];
  const defaults = Array.isArray(options?.signInPoolDefault) ? options.signInPoolDefault : [];
  const signedInKeys = new Set(technicians.map((tech) => normalizeNameKey(tech?.name)).filter(Boolean));
  let signInPool = existingPool;

  if (defaults.length) {
    // Keep pool order aligned to settings roster order.
    const nextPool = [];
    const seen = new Set();
    defaults.forEach((entryName) => {
      const key = normalizeNameKey(entryName);
      if (!key || seen.has(key) || signedInKeys.has(key)) return;
      seen.add(key);
      nextPool.push(entryName);
    });
    signInPool = nextPool;
  }

  return { technicians, signInPool, removed: removed || null };
}

const TurnManagerState = {
  isActiveQueueEntryForBoardSync,
  buildTechnicianRecord,
  signInTechnician,
  signOutTechnician,
};

if (typeof window !== 'undefined') {
  window.TurnManagerState = Object.freeze({
    ...(window.TurnManagerState || {}),
    ...TurnManagerState,
  });
}

export default TurnManagerState;
