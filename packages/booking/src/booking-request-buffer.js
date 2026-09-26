const MAX_BUFFER_MINUTES = 1435;
const DAY_MINUTES = 24 * 60;

export function clampBookingRequestBufferMinutes(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(MAX_BUFFER_MINUTES, Math.max(0, Math.round(num)));
}

export function readBookingRequestBufferMinutes(source) {
  if (!source || typeof source !== 'object') return 0;
  const raw = source.bookingRequestBufferMinutes;
  return clampBookingRequestBufferMinutes(raw);
}

export function bufferAppointmentIntervals(intervals, bufferMinutes) {
  const buffer = clampBookingRequestBufferMinutes(bufferMinutes);
  if (!Array.isArray(intervals) || !intervals.length) return [];
  if (buffer <= 0) {
    return intervals
      .filter(entry => entry && Number.isFinite(entry.start) && Number.isFinite(entry.end) && entry.end > entry.start)
      .map(entry => ({ start: entry.start, end: entry.end }));
  }
  return intervals.reduce((acc, entry) => {
    if (!entry || !Number.isFinite(entry.start) || !Number.isFinite(entry.end)) return acc;
    if (entry.end <= entry.start) return acc;
    const start = Math.max(0, entry.start - buffer);
    const end = Math.min(DAY_MINUTES, entry.end + buffer);
    if (end > start) acc.push({ start, end });
    return acc;
  }, []);
}
