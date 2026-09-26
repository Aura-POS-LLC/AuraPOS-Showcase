export function digitsOnlyPhone(raw) {
  return String(raw ?? '').replace(/[^0-9]/g, '').slice(0, 32);
}

export function canonicalUsPhone10(raw) {
  const digits = digitsOnlyPhone(raw);
  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

export function buildPhoneLookupKeys(raw) {
  const digits = digitsOnlyPhone(raw);
  const canonical = canonicalUsPhone10(digits);
  const keys = new Set();
  if (digits) keys.add(digits);
  if (canonical) keys.add(canonical);
  return Array.from(keys);
}

export function phoneMatches(a, b) {
  const left = buildPhoneLookupKeys(a);
  const right = new Set(buildPhoneLookupKeys(b));
  if (!left.length || !right.size) return false;
  return left.some((key) => right.has(key));
}

export default {
  digitsOnlyPhone,
  canonicalUsPhone10,
  buildPhoneLookupKeys,
  phoneMatches,
};
