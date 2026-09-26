function singleFlightKey(userId, locationId) {
  if (!Number.isFinite(Number(userId)) || !locationId) return null;
  return `${Math.trunc(Number(userId))}:${String(locationId)}`;
}

export function createCheckoutTicketsSingleFlightLoader(loader) {
  const inFlight = new Map();

  async function load(userId, locationId) {
    const key = singleFlightKey(userId, locationId);
    if (!key) return loader(userId, locationId);
    const existing = inFlight.get(key);
    if (existing) return existing;
    const pending = Promise.resolve()
      .then(() => loader(userId, locationId))
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, pending);
    return pending;
  }

  load.inFlightSize = () => inFlight.size;
  return load;
}
