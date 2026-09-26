function createStatusError(status, message) {
  const err = new Error(message || 'Error');
  err.status = status;
  return err;
}

function timestampMs(raw) {
  if (raw instanceof Date && !Number.isNaN(raw.valueOf())) {
    return raw.getTime();
  }
  if (typeof raw === 'string' || typeof raw === 'number') {
    const parsed = Date.parse(String(raw));
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

export function applyLoyaltyDeltaToBalance(currentPoints, delta, { errorMessage = 'Insufficient points for this operation.' } = {}) {
  const current = Math.max(0, Number.parseInt(currentPoints, 10) || 0);
  const change = Number.parseInt(delta, 10);
  if (!Number.isFinite(change) || change === 0) {
    throw createStatusError(400, 'delta must be a non-zero integer.');
  }
  const next = current + change;
  if (next < 0) {
    throw createStatusError(400, errorMessage);
  }
  return next;
}

export function hasExistingLoyaltyRedemption(rows = []) {
  return (Array.isArray(rows) ? rows : []).some((row) => {
    const id = Number(row?.id);
    const status = String(row?.status || 'applied').toLowerCase();
    return Number.isFinite(id) && id > 0 && status === 'applied';
  });
}

export function hasExistingLoyaltyEarnEvent(rows = []) {
  return (Array.isArray(rows) ? rows : []).some((row) => {
    const id = Number(row?.id);
    return Number.isFinite(id) && id > 0;
  });
}

export function hasExistingLoyaltyEarnReversal(rows = []) {
  return hasExistingLoyaltyEarnEvent(rows);
}

export function calculateExpirablePointsFromLedgerEntries(entries = [], cutoffDate = null) {
  const cutoffMs = timestampMs(cutoffDate);
  if (!Number.isFinite(cutoffMs)) return 0;
  const lots = [];
  let cursor = 0;

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const delta = Number.parseInt(entry?.delta, 10) || 0;
    if (!delta) return;
    const createdMs = timestampMs(entry?.created_at || entry?.createdAt);
    if (!Number.isFinite(createdMs)) return;

    if (delta > 0) {
      lots.push({ remaining: delta, createdMs });
      return;
    }

    let toConsume = Math.abs(delta);
    while (toConsume > 0 && cursor < lots.length) {
      const lot = lots[cursor];
      if (!lot || lot.remaining <= 0) {
        cursor += 1;
        continue;
      }
      const take = Math.min(lot.remaining, toConsume);
      lot.remaining -= take;
      toConsume -= take;
      if (lot.remaining <= 0) cursor += 1;
    }
  });

  return lots.reduce((sum, lot) => {
    if (!lot || lot.remaining <= 0) return sum;
    if (lot.createdMs > cutoffMs) return sum;
    return sum + lot.remaining;
  }, 0);
}

