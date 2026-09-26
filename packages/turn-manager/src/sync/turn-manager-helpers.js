/**
 * Pure helpers shared by the turn manager UI and Node tests.
 */

export function normalizeServiceOrderMode(mode) {
  if (typeof mode !== 'string') return 'manual';
  const normalized = mode.trim().toLowerCase();
  return normalized === 'turns_desc' || normalized === 'turns_asc' ? normalized : 'manual';
}

export function serviceTurnsValue(svc) {
  const val = Number(svc?.turns);
  return Number.isFinite(val) ? val : 0;
}

export function orderedServiceIds(section, settings) {
  if (!section || !settings) return [];
  const ids = Array.isArray(section.serviceIds) ? section.serviceIds.slice() : [];
  const mode = normalizeServiceOrderMode(settings?.serviceOrderMode);
  if (mode === 'manual') return ids;
  const idxMap = new Map(ids.map((id, idx) => [id, idx]));
  ids.sort((a, b) => {
    const svcA = settings.servicesById?.[a];
    const svcB = settings.servicesById?.[b];
    const diff = serviceTurnsValue(svcA) - serviceTurnsValue(svcB);
    if (diff !== 0) return mode === 'turns_desc' ? -diff : diff;
    const nameDiff = (svcA?.name || '').localeCompare(svcB?.name || '', undefined, { sensitivity: 'base' });
    if (nameDiff !== 0) return nameDiff;
    return (idxMap.get(a) ?? 0) - (idxMap.get(b) ?? 0);
  });
  return ids;
}

export function allServicesInOrder(settings = { sections: [], servicesById: {} }) {
  const out = [];
  (settings.sections || []).forEach(sec => {
    (sec.serviceIds || []).forEach(id => {
      const s = settings.servicesById?.[id];
      if (s) out.push(s);
    });
  });
  return out;
}

export function serviceNamesFromSettings(settings = { sections: [], servicesById: {} }) {
  const names = [];
  (settings.sections || []).forEach(sec => {
    orderedServiceIds(sec, settings).forEach(id => {
      const svc = settings.servicesById?.[id];
      if (svc && svc.showOnBoard !== false) names.push(svc.name);
    });
  });
  return names;
}

export function skillNamesForTech(name, settings = { technicians: [], servicesById: {} }) {
  if (!settings) return [];
  const rec = (settings.technicians || []).find(t => t.name === name);
  if (!rec) return serviceNamesFromSettings(settings);
  const ids = (rec.skillIds && rec.skillIds.length)
    ? rec.skillIds
    : Object.keys(settings.servicesById || {});
  return ids.map(id => settings.servicesById?.[id]?.name).filter(Boolean);
}

function normalizeSkillMatchKey(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeServiceId(value) {
  return String(value || '').trim();
}

function findSettingsTechnicianRecord(tech, settings = {}) {
  const technicians = Array.isArray(settings?.technicians) ? settings.technicians : [];
  if (!technicians.length) return null;
  const techId = normalizeServiceId(tech?.id);
  const techName = normalizeSkillMatchKey(tech?.name || tech);
  return technicians.find((item) => {
    const itemId = normalizeServiceId(item?.id);
    if (techId && itemId && techId === itemId) return true;
    return !!techName && normalizeSkillMatchKey(item?.name) === techName;
  }) || null;
}

function resolveSettingsServiceId(service, settings = {}) {
  const directId = normalizeServiceId(
    service?.id || service?.serviceId || service?.service_id || service?.sid
  );
  const servicesById = settings?.servicesById && typeof settings.servicesById === 'object'
    ? settings.servicesById
    : {};
  if (directId && servicesById[directId]) return directId;
  if (directId && !Object.keys(servicesById).length) return directId;
  const serviceName = normalizeSkillMatchKey(
    service?.name || service?.serviceName || service?.service || service?.label || service
  );
  if (!serviceName) return '';
  const match = Object.entries(servicesById).find(([, record]) => (
    normalizeSkillMatchKey(record?.name || record?.serviceName || record?.service || '') === serviceName
  ));
  return match?.[0] || '';
}

function resolveServiceCapabilityName(service, settings = {}) {
  const directName = String(
    service?.name || service?.serviceName || service?.service || service?.label || service || ''
  ).trim();
  if (directName) return directName;
  const serviceId = resolveSettingsServiceId(service, settings);
  return serviceId ? String(settings?.servicesById?.[serviceId]?.name || '').trim() : '';
}

export function technicianCanPerformService(tech, service, settings = { technicians: [], servicesById: {} }) {
  const serviceName = resolveServiceCapabilityName(service, settings);
  const serviceId = resolveSettingsServiceId(service, settings);
  if (!serviceName && !serviceId) return true;

  const record = findSettingsTechnicianRecord(tech, settings);
  if (record) {
    const rawSkillIds = Array.isArray(record.skillIds)
      ? record.skillIds
      : (Array.isArray(record.skill_ids) ? record.skill_ids : []);
    if (!rawSkillIds.length) return true;
    const skillIds = new Set(rawSkillIds.map(normalizeServiceId).filter(Boolean));
    if (serviceId && skillIds.has(serviceId)) return true;
    const servicesById = settings?.servicesById && typeof settings.servicesById === 'object'
      ? settings.servicesById
      : {};
    const serviceKey = normalizeSkillMatchKey(serviceName);
    return Array.from(skillIds).some((id) => (
      normalizeSkillMatchKey(servicesById[id]?.name || id) === serviceKey
    ));
  }

  const skills = Array.isArray(tech?.skills) ? tech.skills : [];
  if (!skills.length) return true;
  const skillNames = new Set(skills.map(normalizeSkillMatchKey).filter(Boolean));
  return skillNames.has(normalizeSkillMatchKey(serviceName));
}

function normalizeQueueServiceLabelKey(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeQueueAssignmentRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const serviceName = String(raw.serviceName || raw.assignedServiceName || '').trim();
  const serviceIndexRaw = Number(raw.serviceIndex ?? raw.assignedServiceIndex);
  const serviceIndex = Number.isInteger(serviceIndexRaw) && serviceIndexRaw >= 0
    ? serviceIndexRaw
    : null;
  return {
    serviceName,
    serviceIndex,
  };
}

function normalizeQueueServiceLabelList(rawServices) {
  if (!Array.isArray(rawServices)) return [];
  return rawServices.map((svc) => {
    if (svc && typeof svc === 'object') {
      return String(svc.service || svc.name || '').trim();
    }
    return String(svc || '').trim();
  });
}

export function normalizeQueueServiceCompletionOverrides(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  Object.entries(raw).forEach(([indexKey, value]) => {
    const index = Number(indexKey);
    if (!Number.isInteger(index) || index < 0) return;
    if (value === true || value === false) {
      out[String(index)] = value;
    }
  });
  return out;
}

export function deriveQueueAssignedServiceIndexes(rawServices = [], rawAssignments = []) {
  const labels = normalizeQueueServiceLabelList(rawServices);
  const assignments = Array.isArray(rawAssignments) ? rawAssignments : [];
  const indexByLabel = new Map();
  labels.forEach((name, idx) => {
    const key = normalizeQueueServiceLabelKey(name);
    if (!key) return;
    const bucket = indexByLabel.get(key) || [];
    bucket.push(idx);
    indexByLabel.set(key, bucket);
  });

  const claimed = new Set();
  assignments.forEach((assignmentRaw) => {
    const assignment = normalizeQueueAssignmentRecord(assignmentRaw);
    if (!assignment) return;
    if (Number.isInteger(assignment.serviceIndex)) {
      if (assignment.serviceIndex >= 0 && assignment.serviceIndex < labels.length) {
        claimed.add(assignment.serviceIndex);
      }
      return;
    }
    const labelKey = normalizeQueueServiceLabelKey(assignment.serviceName);
    if (!labelKey) return;
    const candidates = indexByLabel.get(labelKey) || [];
    const match = candidates.find((idx) => !claimed.has(idx));
    if (Number.isInteger(match)) {
      claimed.add(match);
    }
  });
  return claimed;
}

export function resolveSelectedQueueServicesForAssignment({
  services = [],
  serviceChoices = [],
  selectedKeys = [],
  existingAssignments = [],
} = {}) {
  const labels = normalizeQueueServiceLabelList(services);
  const choices = Array.isArray(serviceChoices) ? serviceChoices : [];
  const selectedSet = new Set((Array.isArray(selectedKeys) ? selectedKeys : [])
    .map((key) => String(key || '').trim())
    .filter(Boolean));
  if (!selectedSet.size || !choices.length) return [];

  const indexByLabel = new Map();
  labels.forEach((name, idx) => {
    const key = normalizeQueueServiceLabelKey(name);
    if (!key) return;
    const bucket = indexByLabel.get(key) || [];
    bucket.push(idx);
    indexByLabel.set(key, bucket);
  });

  const usedIndexes = deriveQueueAssignedServiceIndexes(labels, existingAssignments);
  const selectedIndexes = new Set();
  const selectedServices = [];
  choices.forEach((choice) => {
    const choiceKey = String(choice?.key || '').trim();
    if (!choiceKey || !selectedSet.has(choiceKey)) return;

    const fallbackLabel = String(choice?.label || choice?.serviceName || '').trim();
    const explicitIndexRaw = Number(choice?.serviceIndex ?? choice?.assignedServiceIndex);
    if (Number.isInteger(explicitIndexRaw)
      && explicitIndexRaw >= 0
      && explicitIndexRaw < labels.length
      && !selectedIndexes.has(explicitIndexRaw)) {
      usedIndexes.add(explicitIndexRaw);
      selectedIndexes.add(explicitIndexRaw);
      selectedServices.push({
        serviceName: labels[explicitIndexRaw] || fallbackLabel,
        serviceIndex: explicitIndexRaw,
      });
      return;
    }

    const serviceKey = normalizeQueueServiceLabelKey(choice?.serviceKey || fallbackLabel);
    const candidates = serviceKey ? (indexByLabel.get(serviceKey) || []) : [];
    const matchedIndex = candidates.find((index) => !usedIndexes.has(index));
    if (Number.isInteger(matchedIndex)) {
      usedIndexes.add(matchedIndex);
      selectedIndexes.add(matchedIndex);
      selectedServices.push({
        serviceName: labels[matchedIndex] || fallbackLabel,
        serviceIndex: matchedIndex,
      });
      return;
    }

    if (fallbackLabel) {
      selectedServices.push({
        serviceName: fallbackLabel,
        serviceIndex: null,
      });
    }
  });
  return selectedServices;
}

export function resolveQueueServiceCompletionState({
  services = [],
  assignments = [],
  overrides = {},
} = {}) {
  const labels = normalizeQueueServiceLabelList(services);
  const baseCompleted = deriveQueueAssignedServiceIndexes(labels, assignments);
  const normalizedOverrides = normalizeQueueServiceCompletionOverrides(overrides);
  const finalCompleted = new Set(baseCompleted);
  Object.entries(normalizedOverrides).forEach(([indexKey, value]) => {
    const index = Number(indexKey);
    if (!Number.isInteger(index) || index < 0 || index >= labels.length) return;
    if (value === true) finalCompleted.add(index);
    else finalCompleted.delete(index);
  });
  return {
    labels,
    baseCompleted,
    finalCompleted,
    overrides: normalizedOverrides,
  };
}

export function toggleQueueServiceCompletionOverride({
  services = [],
  assignments = [],
  overrides = {},
  serviceIndex = null,
} = {}) {
  const state = resolveQueueServiceCompletionState({ services, assignments, overrides });
  const index = Number(serviceIndex);
  if (!Number.isInteger(index) || index < 0 || index >= state.labels.length) {
    return state;
  }
  const baseHas = state.baseCompleted.has(index);
  const currentHas = state.finalCompleted.has(index);
  const nextHas = !currentHas;
  const nextOverrides = { ...state.overrides };
  if (nextHas === baseHas) {
    delete nextOverrides[String(index)];
  } else {
    nextOverrides[String(index)] = nextHas;
  }
  return resolveQueueServiceCompletionState({
    services: state.labels,
    assignments,
    overrides: nextOverrides,
  });
}

function normalizeAppointmentMatchId(value) {
  const normalized = String(value || '').trim();
  return normalized ? normalized : '';
}

function normalizeAppointmentMatchDate(item, fallbackDate = '') {
  const date = item?.date || item?.appointmentDate || item?.appointment_date || fallbackDate || '';
  return typeof date === 'string' ? date.trim().slice(0, 10) : '';
}

function normalizeAppointmentMatchName(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeAppointmentMatchPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

function normalizeAppointmentRequestString(value, maxLength = 160) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  return normalized.slice(0, maxLength);
}

function normalizeAppointmentRequestVisitType(value) {
  return String(value || '').trim().toLowerCase();
}

export function isRequestAppointmentForQueue(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.isRequest === true || item.requestSeat === true) return true;
  const type = normalizeAppointmentRequestVisitType(item?.visitType || item?.visit_type);
  if (!type) return false;
  if (type.includes('non-request') || type.includes('none-request')) return false;
  return type.includes('request');
}

export function buildAppointmentRequestMetadata(appointments = []) {
  const requests = [];
  const seen = new Set();
  (Array.isArray(appointments) ? appointments : []).forEach((appt, index) => {
    if (!isRequestAppointmentForQueue(appt)) return;
    const appointmentId = normalizeAppointmentRequestString(
      appt?.id || appt?.appointmentId || appt?.appointment_id,
      120
    );
    const techName = normalizeAppointmentRequestString(
      appt?.tech || appt?.technician || appt?.techName || appt?.tech_name || appt?.assignedTechName || appt?.assignedTech,
      80
    );
    const serviceName = normalizeAppointmentRequestString(
      appt?.service || appt?.serviceName || appt?.service_name || appt?.name,
      160
    );
    const serviceId = normalizeAppointmentRequestString(
      appt?.sid || appt?.serviceId || appt?.service_id,
      120
    );
    const techId = normalizeAppointmentRequestString(appt?.techId || appt?.tech_id, 120);
    const date = normalizeAppointmentRequestString(
      appt?.date || appt?.appointmentDate || appt?.appointment_date,
      40
    );
    const startRaw = Number(appt?.startMin ?? appt?.start_min ?? appt?.startMinutes ?? appt?.start_minutes);
    const startMin = Number.isFinite(startRaw) ? Math.max(0, Math.trunc(startRaw)) : null;
    const key = appointmentId || `${techName}|${serviceName}|${date}|${startMin ?? 'na'}|${index}`;
    if (!key || seen.has(key)) return;
    seen.add(key);
    const next = {
      visitType: 'online-request',
      techName,
      serviceName,
    };
    if (appointmentId) next.appointmentId = appointmentId;
    if (serviceId) next.serviceId = serviceId;
    if (techId) next.techId = techId;
    if (date) next.date = date;
    if (startMin !== null) next.startMin = startMin;
    requests.push(next);
  });
  return requests;
}

function normalizeAppointmentMatchCustomerId(value) {
  const raw = value === null || value === undefined ? '' : String(value).trim();
  return raw ? raw : '';
}

function appointmentMatchId(item) {
  return normalizeAppointmentMatchId(item?.id || item?.appointmentId || item?.appointment_id);
}

function appointmentMatchCustomerId(item) {
  return normalizeAppointmentMatchCustomerId(item?.customerId ?? item?.customer_id);
}

function appointmentMatchIdentityKey(item, fallbackDate = '') {
  const date = normalizeAppointmentMatchDate(item, fallbackDate);
  const name = normalizeAppointmentMatchName(item?.name);
  const phone = normalizeAppointmentMatchPhone(item?.phone);
  if (!date || (!name && !phone)) return '';
  return `d:${date}|${name}|${phone}`;
}

function queueEntryAppointmentIds(entry) {
  const ids = [];
  const metaIds = Array.isArray(entry?.meta?.appointmentIds) ? entry.meta.appointmentIds : [];
  const metaAlt = Array.isArray(entry?.meta?.appointment_ids) ? entry.meta.appointment_ids : [];
  const topIds = Array.isArray(entry?.appointmentIds) ? entry.appointmentIds : [];
  const topAlt = Array.isArray(entry?.appointment_ids) ? entry.appointment_ids : [];
  const single = entry?.appointmentId || entry?.appointment_id;
  [...metaIds, ...metaAlt, ...topIds, ...topAlt, single].forEach((val) => {
    const id = normalizeAppointmentMatchId(val);
    if (id && !ids.includes(id)) ids.push(id);
  });
  return ids;
}

function queueEntryRelativeStartMinutes(entry, startOffsetMinutes) {
  const raw = entry?.appointmentTimeMinutes ?? entry?.appointment_time_minutes;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes)) return null;
  const offset = Number.isFinite(Number(startOffsetMinutes)) ? Number(startOffsetMinutes) : 8 * 60;
  return minutes < offset
    ? Math.max(0, minutes)
    : Math.max(0, minutes - offset);
}

function appointmentStartMatches(item, relativeStart) {
  if (relativeStart === null) return true;
  const start = Number(item?.startMin ?? item?.start_min ?? item?.startMinutes ?? item?.start_minutes);
  return Number.isFinite(start) && start === relativeStart;
}

function expandAppointmentMatches(dayAppointments, seedMatches, entry, targetDate, options = {}) {
  const matches = Array.isArray(seedMatches) ? seedMatches.filter(Boolean) : [];
  if (!matches.length) return [];
  const allowIdentityExpansion = options.allowIdentityExpansion !== false;
  const groupIds = new Set(
    matches
      .map(item => String(item?.groupId || item?.group_id || '').trim())
      .filter(Boolean)
  );
  if (groupIds.size) {
    return dayAppointments.filter(item => (
      groupIds.has(String(item?.groupId || item?.group_id || '').trim())
    ));
  }
  const servicesMeta = Array.isArray(entry?.meta?.services) ? entry.meta.services : [];
  if (allowIdentityExpansion && (servicesMeta.length > 1 || matches.length > 1)) {
    const identityKeys = new Set(
      matches
        .map(item => appointmentMatchIdentityKey(item, targetDate))
        .filter(Boolean)
    );
    if (identityKeys.size) {
      return dayAppointments.filter(item => (
        identityKeys.has(appointmentMatchIdentityKey(item, targetDate))
      ));
    }
  }
  return matches;
}

function strongestIdentityMatches(dayAppointments, predicate, entry, targetDate, relativeStart) {
  const exactMatches = dayAppointments.filter(item => predicate(item) && appointmentStartMatches(item, relativeStart));
  if (exactMatches.length) {
    return expandAppointmentMatches(dayAppointments, exactMatches, entry, targetDate, {
      allowIdentityExpansion: true,
    });
  }
  if (relativeStart === null) return [];
  const looseMatches = dayAppointments.filter(item => predicate(item));
  if (!looseMatches.length) return [];
  let seed = looseMatches[0];
  let bestDiff = Number.POSITIVE_INFINITY;
  looseMatches.forEach((item) => {
    const start = Number(item?.startMin ?? item?.start_min ?? item?.startMinutes ?? item?.start_minutes);
    if (!Number.isFinite(start)) return;
    const diff = Math.abs(start - relativeStart);
    if (diff < bestDiff) {
      bestDiff = diff;
      seed = item;
    }
  });
  return expandAppointmentMatches(dayAppointments, [seed], entry, targetDate, {
    allowIdentityExpansion: true,
  });
}

function uniqueNameOnlyMatches(dayAppointments, entry, targetDate, relativeStart) {
  const entryName = normalizeAppointmentMatchName(entry?.name);
  if (!entryName) return [];
  const byName = (item) => normalizeAppointmentMatchName(item?.name) === entryName;
  const exactMatches = dayAppointments.filter(item => byName(item) && appointmentStartMatches(item, relativeStart));
  if (exactMatches.length === 1) {
    return expandAppointmentMatches(dayAppointments, exactMatches, entry, targetDate, {
      allowIdentityExpansion: false,
    });
  }
  if (exactMatches.length > 1 || relativeStart === null) return [];
  const looseMatches = dayAppointments.filter(byName);
  if (looseMatches.length !== 1) return [];
  return expandAppointmentMatches(dayAppointments, looseMatches, entry, targetDate, {
    allowIdentityExpansion: false,
  });
}

export function resolveAppointmentsForQueueEntry({
  appointments = [],
  entry = null,
  dateKey = '',
  autoAssignStartMinutes = 8 * 60,
} = {}) {
  const list = Array.isArray(appointments) ? appointments : [];
  const targetDate = normalizeAppointmentMatchDate(entry, dateKey);
  const dayAppointments = targetDate
    ? list.filter(item => normalizeAppointmentMatchDate(item, targetDate) === targetDate)
    : list.slice();
  if (!dayAppointments.length) return [];

  const entryIds = queueEntryAppointmentIds(entry);
  if (entryIds.length) {
    const byId = dayAppointments.filter(item => entryIds.includes(appointmentMatchId(item)));
    if (byId.length) {
      return expandAppointmentMatches(dayAppointments, byId, entry, targetDate, {
        allowIdentityExpansion: true,
      });
    }
  }

  const relativeStart = queueEntryRelativeStartMinutes(entry, autoAssignStartMinutes);
  const entryCustomerId = normalizeAppointmentMatchCustomerId(entry?.customerId ?? entry?.customer_id ?? entry?.meta?.customerId);
  if (entryCustomerId) {
    const customerMatches = strongestIdentityMatches(
      dayAppointments,
      item => appointmentMatchCustomerId(item) === entryCustomerId,
      entry,
      targetDate,
      relativeStart
    );
    if (customerMatches.length) return customerMatches;
  }

  const entryPhone = normalizeAppointmentMatchPhone(
    entry?.phoneDigits || entry?.phone_digits || entry?.phone || entry?.phoneDisplay || entry?.phone_display
  );
  if (entryPhone) {
    return strongestIdentityMatches(
      dayAppointments,
      item => normalizeAppointmentMatchPhone(item?.phone) === entryPhone,
      entry,
      targetDate,
      relativeStart
    );
  }

  return uniqueNameOnlyMatches(dayAppointments, entry, targetDate, relativeStart);
}

const TurnManagerHelpers = {
  allServicesInOrder,
  serviceNamesFromSettings,
  orderedServiceIds,
  skillNamesForTech,
  technicianCanPerformService,
  normalizeServiceOrderMode,
  serviceTurnsValue,
  normalizeQueueServiceCompletionOverrides,
  deriveQueueAssignedServiceIndexes,
  resolveSelectedQueueServicesForAssignment,
  resolveQueueServiceCompletionState,
  toggleQueueServiceCompletionOverride,
  resolveAppointmentsForQueueEntry,
  isRequestAppointmentForQueue,
  buildAppointmentRequestMetadata,
};

if (typeof window !== 'undefined') {
  window.TurnManagerHelpers = Object.freeze({
    ...(window.TurnManagerHelpers || {}),
    ...TurnManagerHelpers,
  });
}

export default TurnManagerHelpers;
