function normalizePositiveInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.trunc(parsed);
  return normalized > 0 ? normalized : null;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function normalizePhoneDigits(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function addUnique(list, seen, value) {
  const text = normalizeText(value);
  if (!text || seen.has(text)) return;
  seen.add(text);
  list.push(text);
}

function addUniqueNumber(list, seen, value) {
  const parsed = normalizePositiveInteger(value);
  if (parsed === null || seen.has(parsed)) return;
  seen.add(parsed);
  list.push(parsed);
}

function normalizeAppointmentIdList(...sources) {
  const list = [];
  const seen = new Set();
  sources.forEach((source) => {
    if (Array.isArray(source)) {
      source.forEach((item) => addUnique(list, seen, item));
      return;
    }
    addUnique(list, seen, source);
  });
  return list;
}

function collectFromCustomerLike(source, state) {
  if (!source || typeof source !== 'object') return;

  addUniqueNumber(state.queueEntryIds, state.queueEntryIdSeen, source.queueEntryId);
  addUniqueNumber(state.queueEntryIds, state.queueEntryIdSeen, source.queue_entry_id);
  addUniqueNumber(state.queueEntryIds, state.queueEntryIdSeen, source.entryId);
  addUniqueNumber(state.queueEntryIds, state.queueEntryIdSeen, source.entry_id);
  addUniqueNumber(state.queueEntryIds, state.queueEntryIdSeen, source.queueId);
  addUniqueNumber(state.queueEntryIds, state.queueEntryIdSeen, source.queue_id);

  addUniqueNumber(state.customerIds, state.customerIdSeen, source.customerId);
  addUniqueNumber(state.customerIds, state.customerIdSeen, source.customer_id);

  normalizeAppointmentIdList(
    source.appointmentId,
    source.appointment_id,
    source.appointmentIds,
    source.appointment_ids,
    source.meta?.appointmentIds,
    source.meta?.appointment_ids,
  ).forEach((id) => addUnique(state.appointmentIds, state.appointmentIdSeen, id));

  const phoneDigits = normalizePhoneDigits(source.phoneDigits || source.phone_digits || source.phone);
  const name = normalizeLower(source.name || source.customerName || source.customer_name);
  if (phoneDigits && name) {
    const key = `${name}|${phoneDigits}`;
    if (!state.phoneNameSeen.has(key)) {
      state.phoneNameSeen.add(key);
      state.phoneNamePairs.push({ name, phoneDigits });
    }
  }
}

export function collectTicketQueueCompletionCandidates(ticketSnapshot = {}) {
  const state = {
    queueEntryIds: [],
    queueEntryIdSeen: new Set(),
    customerIds: [],
    customerIdSeen: new Set(),
    appointmentIds: [],
    appointmentIdSeen: new Set(),
    phoneNamePairs: [],
    phoneNameSeen: new Set(),
  };

  collectFromCustomerLike(ticketSnapshot, state);
  collectFromCustomerLike(ticketSnapshot?.customer, state);
  if (Array.isArray(ticketSnapshot?.customers)) {
    ticketSnapshot.customers.forEach((customer) => collectFromCustomerLike(customer, state));
  }
  if (Array.isArray(ticketSnapshot?.techs)) {
    ticketSnapshot.techs.forEach((group) => {
      collectFromCustomerLike(group, state);
      collectFromCustomerLike(group?.customer, state);
    });
  }

  return {
    queueEntryIds: state.queueEntryIds,
    customerIds: state.customerIds,
    appointmentIds: state.appointmentIds,
    phoneNamePairs: state.phoneNamePairs,
  };
}

function hasCandidateSignals(candidates) {
  return Boolean(
    candidates.queueEntryIds.length
    || candidates.customerIds.length
    || candidates.appointmentIds.length
    || candidates.phoneNamePairs.length
  );
}

function rowLocationMatches(row, locationId) {
  const target = normalizeText(locationId);
  if (!target) return true;
  const rowLocation = normalizeText(row?.location_id || row?.locationId);
  return !rowLocation || rowLocation === target;
}

function normalizeRowMeta(row) {
  const meta = row?.meta;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) return meta;
  if (typeof meta === 'string' && meta.trim()) {
    try {
      const parsed = JSON.parse(meta);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (_) {
      return {};
    }
  }
  return {};
}

function rowAppointmentIds(row) {
  return normalizeAppointmentIdList(
    row?.appointment_id,
    row?.appointmentId,
    normalizeRowMeta(row).appointmentIds,
    normalizeRowMeta(row).appointment_ids,
  );
}

function findUnique(rows, predicate) {
  const matches = rows.filter(predicate);
  return matches.length === 1 ? matches[0] : null;
}

function ticketCodeValue(ticketSnapshot) {
  const parsed = Number(ticketSnapshot?.ticketCode);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
}

function ticketIdValue(ticketSnapshot) {
  return normalizeText(ticketSnapshot?.id || ticketSnapshot?.ticketId || ticketSnapshot?.ticket_id) || null;
}

function normalizeAssignmentList(meta) {
  const list = Array.isArray(meta?.assignedAssignments)
    ? meta.assignedAssignments
    : (Array.isArray(meta?.assignedTechs) ? meta.assignedTechs : []);
  return list.filter((item) => item && typeof item === 'object');
}

function assignmentTechKey(assignment) {
  return normalizeLower(
    assignment?.techName
    || assignment?.assignedTechName
    || assignment?.assignedTech
    || assignment?.tech
  );
}

function assignmentIsCompleted(assignment) {
  if (!assignment || typeof assignment !== 'object') return false;
  if (normalizeTimestamp(assignment.completedAt || assignment.completed_at)) return true;
  if (normalizeText(assignment.completedTicketId || assignment.completed_ticket_id)) return true;
  const status = normalizeLower(assignment.completionStatus || assignment.completion_status || assignment.status);
  return status === 'completed' || status === 'done';
}

function collectTicketTechKeys(ticketSnapshot = {}) {
  const keys = new Set();
  const add = (value) => {
    const key = normalizeLower(value);
    if (key) keys.add(key);
  };
  add(ticketSnapshot.selectedTech);
  add(ticketSnapshot.tech);
  add(ticketSnapshot.technician);
  if (Array.isArray(ticketSnapshot.techs)) {
    ticketSnapshot.techs.forEach((group) => {
      add(group?.tech);
      add(group?.techName);
      add(group?.technician);
      add(group?.name);
    });
  }
  return keys;
}

function buildCompletedAssignment(assignment, ticketSnapshot, closedAt, completedBy) {
  const completedAt = normalizeTimestamp(closedAt || ticketSnapshot?.closedAt) || new Date().toISOString();
  const next = { ...assignment };
  next.completedAt = completedAt;
  const ticketId = ticketIdValue(ticketSnapshot);
  if (ticketId) next.completedTicketId = ticketId;
  const ticketCode = ticketCodeValue(ticketSnapshot);
  if (ticketCode !== null) next.completedTicketCode = ticketCode;
  const by = normalizeText(completedBy);
  if (by) next.completedBy = by;
  next.completionStatus = 'completed';
  return next;
}

function buildAssignmentCompletionUpdate(row, ticketSnapshot, closedAt, completedBy) {
  const meta = normalizeRowMeta(row);
  const assignments = normalizeAssignmentList(meta);
  if (!assignments.length) {
    return {
      hasAssignments: false,
      matchedAssignmentCount: 0,
      alreadyCompletedAssignmentCount: 0,
      changed: false,
      allComplete: false,
      nextMeta: meta,
    };
  }

  const ticketTechKeys = collectTicketTechKeys(ticketSnapshot);
  if (!ticketTechKeys.size) {
    return {
      hasAssignments: true,
      matchedAssignmentCount: 0,
      alreadyCompletedAssignmentCount: 0,
      changed: false,
      allComplete: false,
      nextMeta: meta,
    };
  }

  let changed = false;
  let matchedAssignmentCount = 0;
  let alreadyCompletedAssignmentCount = 0;
  const nextAssignments = assignments.map((assignment) => {
    const techKey = assignmentTechKey(assignment);
    if (!techKey || !ticketTechKeys.has(techKey)) return assignment;
    matchedAssignmentCount += 1;
    if (assignmentIsCompleted(assignment)) {
      alreadyCompletedAssignmentCount += 1;
      return assignment;
    }
    changed = true;
    return buildCompletedAssignment(assignment, ticketSnapshot, closedAt, completedBy);
  });
  const allComplete = nextAssignments.every((assignment) => assignmentIsCompleted(assignment));
  return {
    hasAssignments: true,
    matchedAssignmentCount,
    alreadyCompletedAssignmentCount,
    changed,
    allComplete,
    nextMeta: {
      ...meta,
      assignedAssignments: nextAssignments,
    },
  };
}

function serializeSummary(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: row.id,
    status: row.status,
    completedAt: row.completed_at instanceof Date
      ? row.completed_at.toISOString()
      : (row.completed_at || null),
  };
}

export async function completeQueueEntriesForClosedTicket({
  client = null,
  query = null,
  userId,
  locationId = null,
  ticketSnapshot = {},
  closedAt = null,
  completedBy = '',
} = {}) {
  const runQuery = typeof query === 'function'
    ? query
    : (typeof client?.query === 'function' ? (sql, params) => client.query(sql, params) : null);
  if (typeof runQuery !== 'function') {
    throw new Error('A database query function is required.');
  }

  const candidates = collectTicketQueueCompletionCandidates(ticketSnapshot);
  const attempted = hasCandidateSignals(candidates);
  const unmatched = [];
  if (!attempted) {
    return {
      attempted: false,
      completedRows: [],
      completedEntries: [],
      completedCount: 0,
      updatedCount: 0,
      alreadyCompletedCount: 0,
      unmatched,
      candidates,
    };
  }

  const matchedById = new Map();
  const addMatchedRow = (row) => {
    const id = normalizePositiveInteger(row?.id);
    if (!id || matchedById.has(id)) return;
    matchedById.set(id, row);
  };

  if (candidates.queueEntryIds.length) {
    const directRows = await runQuery(
      `SELECT *
         FROM customer_queue_entries
        WHERE user_id = $1
          AND (location_id = $2 OR location_id IS NULL)
          AND id = ANY($3::bigint[])
        FOR UPDATE`,
      [userId, locationId, candidates.queueEntryIds]
    );
    (directRows.rows || []).forEach(addMatchedRow);
    const foundIds = new Set((directRows.rows || []).map((row) => normalizePositiveInteger(row?.id)).filter(Boolean));
    candidates.queueEntryIds.forEach((id) => {
      if (!foundIds.has(id)) unmatched.push({ type: 'queueEntryId', value: id, reason: 'not_found' });
    });
  }

  const needsFallback = !candidates.queueEntryIds.length && (
    candidates.customerIds.length
    || candidates.appointmentIds.length
    || candidates.phoneNamePairs.length
  );
  if (needsFallback) {
    const activeRows = await runQuery(
      `SELECT *
         FROM customer_queue_entries
        WHERE user_id = $1
          AND (location_id = $2 OR location_id IS NULL)
          AND status IN ('waiting', 'seated')
        FOR UPDATE`,
      [userId, locationId]
    );
    const rows = (activeRows.rows || []).filter((row) => rowLocationMatches(row, locationId));

    candidates.customerIds.forEach((customerId) => {
      const match = findUnique(rows, (row) => normalizePositiveInteger(row?.customer_id) === customerId);
      if (match) addMatchedRow(match);
    });

    candidates.appointmentIds.forEach((appointmentId) => {
      const target = normalizeText(appointmentId);
      const match = findUnique(rows, (row) => rowAppointmentIds(row).includes(target));
      if (match) addMatchedRow(match);
    });

    candidates.phoneNamePairs.forEach(({ name, phoneDigits }) => {
      const match = findUnique(rows, (row) => (
        normalizeLower(row?.name) === name
        && normalizePhoneDigits(row?.phone_digits || row?.phone_display) === phoneDigits
      ));
      if (match) addMatchedRow(match);
    });
  }

  const matchedRows = [...matchedById.values()];
  const activeRows = matchedRows.filter((row) => ['waiting', 'seated'].includes(normalizeLower(row?.status)));
  const alreadyCompletedRows = matchedRows.filter((row) => normalizeLower(row?.status) === 'completed');
  const legacyCompletionIds = [];
  const assignmentCompletionRows = [];
  const partialAssignmentRows = [];
  const matchedCount = matchedRows.length;
  let assignmentMatchedCount = 0;
  let assignmentUpdatedCount = 0;
  let assignmentAlreadyCompletedCount = 0;
  activeRows.forEach((row) => {
    const rowId = normalizePositiveInteger(row?.id);
    if (!rowId) return;
    const assignmentUpdate = buildAssignmentCompletionUpdate(row, ticketSnapshot, closedAt, completedBy);
    if (!assignmentUpdate.hasAssignments) {
      legacyCompletionIds.push(rowId);
      return;
    }
    assignmentMatchedCount += assignmentUpdate.matchedAssignmentCount;
    assignmentAlreadyCompletedCount += assignmentUpdate.alreadyCompletedAssignmentCount;
    if (!assignmentUpdate.matchedAssignmentCount) {
      unmatched.push({ type: 'assignment', value: rowId, reason: 'no_matching_assigned_technician' });
      return;
    }
    if (assignmentUpdate.changed) assignmentUpdatedCount += 1;
    if (assignmentUpdate.allComplete) {
      assignmentCompletionRows.push({ id: rowId, meta: assignmentUpdate.nextMeta });
    } else if (assignmentUpdate.changed) {
      partialAssignmentRows.push({ id: rowId, meta: assignmentUpdate.nextMeta });
    }
  });
  let updatedRows = [];
  let partialRows = [];
  if (legacyCompletionIds.length) {
    const completedAt = closedAt || ticketSnapshot?.closedAt || new Date().toISOString();
    const updated = await runQuery(
      `UPDATE customer_queue_entries
          SET status = 'completed',
              completed_at = $3::timestamptz,
              completed_ticket_id = $4,
              completed_ticket_code = $5,
              completed_by = $6,
              updated_at = NOW()
        WHERE user_id = $1
          AND (location_id = $2 OR location_id IS NULL)
          AND id = ANY($7::bigint[])
          AND status IN ('waiting', 'seated')
      RETURNING *`,
      [
        userId,
        locationId,
        completedAt,
        ticketIdValue(ticketSnapshot),
        ticketCodeValue(ticketSnapshot),
        normalizeText(completedBy) || null,
        legacyCompletionIds,
      ]
    );
    updatedRows.push(...(updated.rows || []));
  }
  for (const row of assignmentCompletionRows) {
    const completedAt = closedAt || ticketSnapshot?.closedAt || new Date().toISOString();
    const updated = await runQuery(
      `UPDATE customer_queue_entries
          SET status = 'completed',
              completed_at = $3::timestamptz,
              completed_ticket_id = $4,
              completed_ticket_code = $5,
              completed_by = $6,
              meta = $7::jsonb,
              updated_at = NOW()
        WHERE user_id = $1
          AND (location_id = $2 OR location_id IS NULL)
          AND id = $8
          AND status IN ('waiting', 'seated')
      RETURNING *`,
      [
        userId,
        locationId,
        completedAt,
        ticketIdValue(ticketSnapshot),
        ticketCodeValue(ticketSnapshot),
        normalizeText(completedBy) || null,
        JSON.stringify(row.meta),
        row.id,
      ]
    );
    updatedRows.push(...(updated.rows || []));
  }
  for (const row of partialAssignmentRows) {
    const updated = await runQuery(
      `UPDATE customer_queue_entries
          SET meta = $3::jsonb,
              updated_at = NOW()
        WHERE user_id = $1
          AND (location_id = $2 OR location_id IS NULL)
          AND id = $4
          AND status IN ('waiting', 'seated')
      RETURNING *`,
      [
        userId,
        locationId,
        JSON.stringify(row.meta),
        row.id,
      ]
    );
    partialRows.push(...(updated.rows || []));
  }

  const completedRows = [...updatedRows, ...alreadyCompletedRows];
  const changedRows = [...updatedRows, ...partialRows];
  return {
    attempted: true,
    completedRows,
    completedEntries: completedRows.map(serializeSummary).filter(Boolean),
    completedCount: completedRows.length,
    updatedCount: updatedRows.length,
    partialUpdatedCount: partialRows.length,
    changedRows,
    changedCount: changedRows.length,
    matchedCount,
    assignmentMatchedCount,
    assignmentUpdatedCount,
    assignmentAlreadyCompletedCount,
    alreadyCompletedCount: alreadyCompletedRows.length,
    unmatched,
    candidates,
  };
}

export const TurnManagerQueueCompletionUtils = Object.freeze({
  collectTicketQueueCompletionCandidates,
  completeQueueEntriesForClosedTicket,
});
