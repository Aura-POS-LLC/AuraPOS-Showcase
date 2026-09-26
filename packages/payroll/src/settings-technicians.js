function normalizeNameKey(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function normalizeTechId(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function sanitizeTechCode(value) {
  const digits = (value ?? '').toString().replace(/[^0-9]/g, '').slice(0, 8);
  return digits.length === 8 ? digits : '';
}

function normalizePhoneDigits(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, 10);
}

function hasPasswordFlag(value) {
  return value === true;
}

const TECH_CALL_TIMES_MIN = 1;
const TECH_CALL_TIMES_MAX = 5;
const DEFAULT_TECH_COLOR = '#e6c57d';
const DEFAULT_TECH_GENDER = 'female';
const DEFAULT_TECH_ALERT_SOUND = 'Default.wav';
const DEFAULT_WORKDAY_START = '09:00';
const DEFAULT_WORKDAY_END = '18:00';

function firstDefinedValue(...values) {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function normalizeDateOnly(value) {
  if (value === null || value === undefined) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  const dateOnly = trimmed.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : '';
}

function normalizeTimeValue(value, fallback) {
  const fallbackValue = typeof fallback === 'string' && fallback ? fallback : DEFAULT_WORKDAY_START;
  const raw = String(value ?? '').trim();
  if (!raw) return fallbackValue;
  const parts = raw.split(':');
  if (parts.length !== 2) return fallbackValue;
  const hh = Number.parseInt(parts[0], 10);
  const mm = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return fallbackValue;
  const safeHour = Math.max(0, Math.min(23, hh));
  const safeMinute = Math.max(0, Math.min(59, mm));
  return `${String(safeHour).padStart(2, '0')}:${String(safeMinute).padStart(2, '0')}`;
}

function normalizeWorkHours(value) {
  if (!Array.isArray(value) || value.length !== 7) return null;
  return value.map((entry) => {
    const day = entry && typeof entry === 'object' ? entry : {};
    const open = day.open === undefined ? true : !!day.open;
    const start = normalizeTimeValue(day.start, DEFAULT_WORKDAY_START);
    const end = normalizeTimeValue(day.end, DEFAULT_WORKDAY_END);
    return { open, start, end };
  });
}

function normalizeOffTimes(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  value.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const startRaw = normalizeDateOnly(firstDefinedValue(entry.start, entry.date));
    if (!startRaw) return;
    const endRaw = normalizeDateOnly(firstDefinedValue(entry.end, entry.start, entry.date)) || startRaw;
    const start = startRaw <= endRaw ? startRaw : endRaw;
    const end = startRaw <= endRaw ? endRaw : startRaw;
    out.push({ start, end });
  });
  return out;
}

function normalizeSkillIds(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  value.forEach((raw) => {
    const sid = String(raw ?? '').trim();
    if (!sid || seen.has(sid)) return;
    seen.add(sid);
    out.push(sid);
  });
  return out;
}

function normalizeTechAlertSound(value) {
  let raw = String(value ?? '').trim();
  if (!raw) return DEFAULT_TECH_ALERT_SOUND;
  if (/^(none|off)$/i.test(raw)) return 'silent';
  if (/^silent$/i.test(raw)) return 'silent';
  if (!/\.wav$/i.test(raw)) {
    raw = `${raw}.wav`;
  }
  return raw.slice(0, 64);
}

function normalizeTechnicianGender(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'male' || normalized === 'female') return normalized;
  return DEFAULT_TECH_GENDER;
}

function normalizeTechnicianShowOnCheckout(value) {
  return value !== false;
}

function canonicalComparisonShape(tech = {}, index = 0) {
  const id = normalizeTechId(tech.id ?? tech.legacy_id);
  const name = typeof tech.name === 'string' ? tech.name.trim() : '';
  const colorRaw = typeof tech.color === 'string' ? tech.color.trim() : '';
  const color = colorRaw || DEFAULT_TECH_COLOR;
  const gender = normalizeTechnicianGender(tech.gender);
  const allowNonRequest = tech.allowNonRequest === true || tech.allow_non_request === true;
  const showOnCheckout = normalizeTechnicianShowOnCheckout(
    firstDefinedValue(tech.showOnCheckout, tech.show_on_checkout)
  );
  const phoneDigits = normalizePhoneDigits(firstDefinedValue(tech.phoneDigits, tech.phone_digits, tech.phone));
  const displayOrder = Number.isFinite(tech.displayOrder) ? Math.round(tech.displayOrder) : index;
  const workHoursRaw = firstDefinedValue(tech.workHours, tech.work_hours);
  const offTimesRaw = firstDefinedValue(tech.offTimes, tech.off_times);
  const skillIdsRaw = firstDefinedValue(tech.skillIds, tech.skill_ids);
  const callTimesRaw = firstDefinedValue(tech.callTimes, tech.call_times);
  const alertSoundRaw = firstDefinedValue(
    tech.alertSound,
    tech.alert_sound,
    tech.notificationSound,
    tech.notification_sound
  );
  return {
    id,
    name,
    color,
    gender,
    allowNonRequest,
    showOnCheckout,
    phoneDigits,
    displayOrder,
    workHours: normalizeWorkHours(workHoursRaw),
    offTimes: normalizeOffTimes(offTimesRaw),
    skillIds: normalizeSkillIds(skillIdsRaw),
    callTimes: clampInteger(callTimesRaw, TECH_CALL_TIMES_MIN, TECH_CALL_TIMES_MAX, TECH_CALL_TIMES_MIN),
    alertSound: normalizeTechAlertSound(alertSoundRaw),
  };
}

function makeWriteShapeError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

export function mergeTechniciansForSettingsRead({
  techniciansFromTable = [],
  existingTechnicians = [],
} = {}) {
  const tableList = Array.isArray(techniciansFromTable) ? techniciansFromTable : [];
  const payloadList = Array.isArray(existingTechnicians) ? existingTechnicians : [];

  if (!tableList.length) {
    return payloadList.slice();
  }

  const merged = tableList.map((tech, index) => {
    const techId = normalizeTechId(tech?.id);
    const techNameKey = normalizeNameKey(tech?.name);
    const match = payloadList.find((entry) => {
      const entryId = normalizeTechId(entry?.id);
      if (entryId && techId && entryId === techId) return true;
      if (!entryId) {
        const entryNameKey = normalizeNameKey(entry?.name);
        if (entryNameKey && techNameKey && entryNameKey === techNameKey) return true;
      }
      return false;
    }) || {};

    const matchedTechCode = sanitizeTechCode(match?.techCode || match?.tech_code);
    const mergedTechCode = sanitizeTechCode(tech?.techCode) || matchedTechCode;
    const mergedHasPassword = hasPasswordFlag(tech?.hasPassword)
      || hasPasswordFlag(match?.hasPassword)
      || hasPasswordFlag(match?.has_password);
    const normalizedTable = canonicalComparisonShape(tech, index);
    const normalizedPayload = canonicalComparisonShape(match, index);

    return {
      ...match,
      id: normalizedTable.id || normalizedPayload.id,
      name: normalizedTable.name || normalizedPayload.name,
      color: normalizedTable.color || normalizedPayload.color,
      gender: normalizedTable.gender || normalizedPayload.gender,
      allowNonRequest: normalizedTable.allowNonRequest,
      showOnCheckout: normalizedTable.showOnCheckout,
      phoneDigits: normalizedTable.phoneDigits || normalizedPayload.phoneDigits,
      displayOrder: Number.isFinite(normalizedTable.displayOrder)
        ? normalizedTable.displayOrder
        : normalizedPayload.displayOrder,
      workHours: normalizedTable.workHours ?? normalizedPayload.workHours,
      offTimes: normalizedTable.offTimes,
      skillIds: normalizedTable.skillIds.length ? normalizedTable.skillIds : normalizedPayload.skillIds,
      callTimes: normalizedTable.callTimes,
      alertSound: normalizedTable.alertSound || normalizedPayload.alertSound,
      techCode: mergedTechCode,
      hasPassword: mergedHasPassword,
    };
  });

  const seenIds = new Set(
    merged.map((tech) => normalizeTechId(tech?.id)).filter(Boolean)
  );
  const seenNameKeys = new Set(
    merged.map((tech) => normalizeNameKey(tech?.name)).filter(Boolean)
  );

  payloadList.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const entryId = normalizeTechId(entry.id);
    const entryNameKey = normalizeNameKey(entry.name);
    if (entryId && seenIds.has(entryId)) return;
    if (!entryId && entryNameKey && seenNameKeys.has(entryNameKey)) return;
    if (!entryId && !entryNameKey) return;

    const appended = { ...entry };
    const normalized = canonicalComparisonShape(entry, merged.length);
    const normalizedCode = sanitizeTechCode(appended?.techCode || appended?.tech_code);
    appended.id = normalized.id;
    appended.name = normalized.name;
    appended.color = normalized.color;
    appended.gender = normalized.gender;
    appended.allowNonRequest = normalized.allowNonRequest;
    appended.showOnCheckout = normalized.showOnCheckout;
    appended.phoneDigits = normalized.phoneDigits;
    appended.displayOrder = normalized.displayOrder;
    appended.workHours = normalized.workHours;
    appended.offTimes = normalized.offTimes;
    appended.skillIds = normalized.skillIds;
    appended.callTimes = normalized.callTimes;
    appended.alertSound = normalized.alertSound;
    appended.techCode = normalizedCode;
    appended.hasPassword = hasPasswordFlag(appended?.hasPassword) || hasPasswordFlag(appended?.has_password);

    merged.push(appended);
    if (entryId) seenIds.add(entryId);
    if (entryNameKey) seenNameKeys.add(entryNameKey);
  });

  return merged;
}

export function validateTechnicianWriteShape(technicians = []) {
  if (technicians === undefined) return [];
  if (!Array.isArray(technicians)) {
    throw makeWriteShapeError('technicians must be an array.');
  }
  const seenIds = new Set();
  return technicians.map((tech, index) => {
    if (!tech || typeof tech !== 'object') {
      throw makeWriteShapeError(`technicians[${index}] must be an object.`);
    }
    const id = normalizeTechId(tech.id ?? tech.legacy_id);
    const name = typeof tech.name === 'string' ? tech.name.trim() : '';
    if (!id) throw makeWriteShapeError(`technicians[${index}].id is required.`);
    if (!name) throw makeWriteShapeError(`technicians[${index}].name is required.`);
    if (seenIds.has(id)) throw makeWriteShapeError(`Duplicate technician id: ${id}`);
    seenIds.add(id);
    for (const [field, max] of [['commissionPercent', 100], ['laundryFee', 1000000], ['guarantee', 1000000]]) {
      const value = tech[field];
      if (value === undefined || value === null || value === '') continue;
      if (!['number', 'string'].includes(typeof value) || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > max) {
        throw makeWriteShapeError(`technicians[${index}].${field} must be a number between 0 and ${max}.`);
      }
    }
    const canonical = canonicalComparisonShape(tech, index);
    const next = {
      ...tech,
      ...(tech.commissionPercent !== undefined ? { commissionPercent: tech.commissionPercent === null || tech.commissionPercent === '' ? null : Math.round(Number(tech.commissionPercent) * 100) / 100 } : {}),
      ...(tech.laundryFee !== undefined ? { laundryFee: Math.round(Number(tech.laundryFee) * 100) / 100 } : {}),
      ...(tech.guarantee !== undefined ? { guarantee: Math.round(Number(tech.guarantee) * 100) / 100 } : {}),
      id,
      name,
      color: canonical.color,
      gender: canonical.gender,
      allowNonRequest: canonical.allowNonRequest,
      showOnCheckout: canonical.showOnCheckout,
      phoneDigits: canonical.phoneDigits,
      displayOrder: index,
      workHours: canonical.workHours,
      offTimes: canonical.offTimes,
      skillIds: canonical.skillIds,
      callTimes: canonical.callTimes,
      alertSound: canonical.alertSound,
      techCode: sanitizeTechCode(tech?.techCode || tech?.tech_code),
      hasPassword: hasPasswordFlag(tech?.hasPassword) || hasPasswordFlag(tech?.has_password),
    };
    if (tech.commissionPercent !== undefined) {
      for (const key of ['percent', 'percentage', 'payoutPercent', 'commission', 'payPercent', 'payRate', 'rate']) delete next[key];
    }
    if (Object.prototype.hasOwnProperty.call(next, 'legacy_id')) delete next.legacy_id;
    if (Object.prototype.hasOwnProperty.call(next, 'allow_non_request')) delete next.allow_non_request;
    if (Object.prototype.hasOwnProperty.call(next, 'show_on_checkout')) delete next.show_on_checkout;
    if (Object.prototype.hasOwnProperty.call(next, 'phone_digits')) delete next.phone_digits;
    if (Object.prototype.hasOwnProperty.call(next, 'phone')) delete next.phone;
    if (Object.prototype.hasOwnProperty.call(next, 'work_hours')) delete next.work_hours;
    if (Object.prototype.hasOwnProperty.call(next, 'off_times')) delete next.off_times;
    if (Object.prototype.hasOwnProperty.call(next, 'skill_ids')) delete next.skill_ids;
    if (Object.prototype.hasOwnProperty.call(next, 'call_times')) delete next.call_times;
    if (Object.prototype.hasOwnProperty.call(next, 'alert_sound')) delete next.alert_sound;
    if (Object.prototype.hasOwnProperty.call(next, 'tech_code')) delete next.tech_code;
    if (Object.prototype.hasOwnProperty.call(next, 'has_password')) delete next.has_password;
    if (Object.prototype.hasOwnProperty.call(next, 'notificationSound')) delete next.notificationSound;
    if (Object.prototype.hasOwnProperty.call(next, 'notification_sound')) delete next.notification_sound;
    return next;
  });
}

export function hasTechnicianCanonicalDrift({
  techniciansFromTable = [],
  mergedTechnicians = [],
} = {}) {
  const tableList = Array.isArray(techniciansFromTable) ? techniciansFromTable : [];
  const mergedList = Array.isArray(mergedTechnicians) ? mergedTechnicians : [];
  if (!tableList.length || !mergedList.length) return false;

  const tableById = new Map();
  tableList.forEach((tech, index) => {
    const id = normalizeTechId(tech?.id ?? tech?.legacy_id);
    if (!id) return;
    const canonical = canonicalComparisonShape(tech, index);
    tableById.set(id, JSON.stringify(canonical));
  });

  for (let index = 0; index < mergedList.length; index += 1) {
    const mergedTech = mergedList[index];
    const id = normalizeTechId(mergedTech?.id ?? mergedTech?.legacy_id);
    if (!id) return true;
    const tableCanonical = tableById.get(id);
    if (!tableCanonical) return true;
    const mergedCanonical = JSON.stringify(canonicalComparisonShape(mergedTech, index));
    if (mergedCanonical !== tableCanonical) return true;
  }
  return false;
}

export function applySyncedTechnicianMetadata({
  technicians = [],
  syncedTechs = [],
  technicianLegacyIdFn,
} = {}) {
  const techList = Array.isArray(technicians) ? technicians : [];
  const syncList = Array.isArray(syncedTechs) ? syncedTechs : [];
  if (!syncList.length) return techList;

  const updateById = new Map();
  syncList.forEach((row) => {
    const id = normalizeTechId(row?.id);
    if (!id) return;
    updateById.set(id, row);
  });

  return techList.map((tech, index) => {
    const legacyId = typeof technicianLegacyIdFn === 'function'
      ? normalizeTechId(technicianLegacyIdFn(tech, index))
      : normalizeTechId(tech?.id);
    if (!legacyId) return tech;
    const update = updateById.get(legacyId);
    if (!update) return tech;
    const next = { ...(tech || {}) };
    if (update?.techCode !== undefined) next.techCode = sanitizeTechCode(update.techCode);
    if (update?.hasPassword !== undefined) next.hasPassword = !!update.hasPassword;
    return next;
  });
}

export async function syncTechniciansForSettingsSave({
  userId,
  technicians = [],
  syncTechniciansTable,
  technicianLegacyIdFn,
} = {}) {
  const techList = Array.isArray(technicians) ? technicians : [];
  if (!techList.length) {
    return {
      technicians: techList,
      syncedTechs: [],
    };
  }
  if (typeof syncTechniciansTable !== 'function') {
    throw new Error('syncTechniciansTable dependency is required.');
  }

  const syncedRaw = await syncTechniciansTable(userId, techList);
  const syncedTechs = Array.isArray(syncedRaw) ? syncedRaw : [];
  const nextTechnicians = applySyncedTechnicianMetadata({
    technicians: techList,
    syncedTechs,
    technicianLegacyIdFn,
  });
  return {
    technicians: nextTechnicians,
    syncedTechs,
  };
}

export async function persistSettingsWithTechnicianSync({
  userId,
  mergedPayload = {},
  syncTechniciansTable,
  technicianLegacyIdFn,
  writeSettingsPayload,
} = {}) {
  if (typeof writeSettingsPayload !== 'function') {
    throw new Error('writeSettingsPayload dependency is required.');
  }

  const payload = (mergedPayload && typeof mergedPayload === 'object')
    ? mergedPayload
    : {};
  const nextTechs = Object.prototype.hasOwnProperty.call(payload, 'technicians')
    ? validateTechnicianWriteShape(payload.technicians)
    : [];
  const syncResult = await syncTechniciansForSettingsSave({
    userId,
    technicians: nextTechs,
    syncTechniciansTable,
    technicianLegacyIdFn,
  });
  payload.technicians = syncResult.technicians;
  await writeSettingsPayload(payload);
  return syncResult;
}

const SettingsTechnicians = {
  mergeTechniciansForSettingsRead,
  validateTechnicianWriteShape,
  hasTechnicianCanonicalDrift,
  applySyncedTechnicianMetadata,
  syncTechniciansForSettingsSave,
  persistSettingsWithTechnicianSync,
};

export default SettingsTechnicians;
