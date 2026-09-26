const present = value => value !== null && value !== undefined && value !== '';

export function resolveCommissionPercent(tech, fallback = 60) {
  // The settings field is always percentage points: 1 means 1%, not 100%.
  if (present(tech?.commissionPercent)) {
    const value = Number(tech.commissionPercent);
    if (Number.isFinite(value)) return Math.max(0, Math.min(100, value));
  }
  for (const key of ['percent', 'percentage', 'payoutPercent', 'commission', 'payPercent', 'payRate', 'rate']) {
    if (!present(tech?.[key])) continue;
    const value = Number(tech[key]);
    if (Number.isFinite(value)) return Math.max(0, Math.min(100, value <= 1 ? value * 100 : value));
  }
  return fallback;
}

export function resolveLaundryFee(tech) {
  const value = Number(tech?.laundryFee);
  return Number.isFinite(value) ? Math.round(Math.max(0, value) * 100) / 100 : 0;
}

export function resolveGuarantee(tech) {
  const value = Number(tech?.guarantee);
  return Number.isFinite(value) ? Math.round(Math.max(0, value) * 100) / 100 : 0;
}

// Compensation lives in the versioned settings payload. Only attach these fields
// to table-owned roster records; never restore deleted technicians from settings.
export function attachTechnicianCompensation(roster, saved = []) {
  const savedList = Array.isArray(saved) ? saved : [];
  return roster.map(tech => {
    const id = String(tech?.id ?? '').trim();
    const match = savedList.find(entry => id && String(entry?.id ?? '').trim() === id)
      || savedList.find(entry => !entry?.id && String(entry?.name ?? '').trim().toLowerCase() === String(tech?.name ?? '').trim().toLowerCase());
    return {
      ...tech,
      commissionPercent: resolveCommissionPercent(match || tech, null),
      laundryFee: resolveLaundryFee(match || tech),
      guarantee: resolveGuarantee(match || tech),
    };
  });
}

// Older roster clients may omit fields they do not know about. Preserve saved
// compensation on omission, while allowing an explicit null to clear the rate.
export function preserveTechnicianCompensation(incoming, saved = []) {
  return incoming.map(tech => {
    const previous = saved.find(entry => String(entry?.id ?? '') === String(tech?.id ?? ''));
    if (!previous) return tech;
    return {
      ...tech,
      ...(tech.commissionPercent === undefined ? { commissionPercent: resolveCommissionPercent(previous, null) } : {}),
      ...(tech.laundryFee === undefined ? { laundryFee: resolveLaundryFee(previous) } : {}),
      ...(tech.guarantee === undefined ? { guarantee: resolveGuarantee(previous) } : {}),
    };
  });
}
