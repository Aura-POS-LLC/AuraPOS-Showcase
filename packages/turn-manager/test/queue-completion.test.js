import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectTicketQueueCompletionCandidates,
  completeQueueEntriesForClosedTicket,
} from '../src/server/queue-completion.js';

test('collects stable queue completion candidates from ticket customer snapshots', () => {
  const candidates = collectTicketQueueCompletionCandidates({
    customer: {
      queueEntryId: '42',
      customerId: '77',
      phone: '(555) 111-2222',
      name: 'Mira',
      appointmentIds: ['appt_1'],
    },
    customers: [{
      queue_entry_id: 43,
      customer_id: 78,
      phoneDigits: '5553334444',
      customerName: 'Lark',
      meta: { appointmentIds: ['appt_2'] },
    }],
    techs: [{
      customer: {
        entryId: 44,
        appointment_id: 'appt_3',
      },
    }],
  });

  assert.deepEqual(candidates.queueEntryIds, [42, 43, 44]);
  assert.deepEqual(candidates.customerIds, [77, 78]);
  assert.deepEqual(candidates.appointmentIds, ['appt_1', 'appt_2', 'appt_3']);
  assert.deepEqual(candidates.phoneNamePairs, [
    { name: 'mira', phoneDigits: '5551112222' },
    { name: 'lark', phoneDigits: '5553334444' },
  ]);
});

test('completes active queue rows by queueEntryId when a ticket closes', async () => {
  const calls = [];
  const closedAt = '2026-05-16T18:30:00.000Z';
  const result = await completeQueueEntriesForClosedTicket({
    userId: 7,
    locationId: 'loc_1',
    closedAt,
    completedBy: 'checkout',
    ticketSnapshot: {
      id: 'ticket_1',
      ticketCode: 1042,
      customer: { queueEntryId: 42 },
    },
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/SELECT \*/i.test(sql) && /id = ANY/i.test(sql)) {
        return {
          rows: [{
            id: 42,
            user_id: 7,
            location_id: 'loc_1',
            status: 'seated',
          }],
        };
      }
      if (/UPDATE customer_queue_entries/i.test(sql)) {
        return {
          rows: [{
            id: 42,
            user_id: 7,
            location_id: 'loc_1',
            status: 'completed',
            completed_at: new Date(params[2]),
            completed_ticket_id: params[3],
            completed_ticket_code: params[4],
            completed_by: params[5],
          }],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  });

  assert.equal(result.attempted, true);
  assert.equal(result.updatedCount, 1);
  assert.equal(result.completedCount, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.completedRows[0]?.completed_ticket_id, 'ticket_1');
  assert.equal(result.completedRows[0]?.completed_ticket_code, 1042);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].params.slice(0, 7), [
    7,
    'loc_1',
    closedAt,
    'ticket_1',
    1042,
    'checkout',
    [42],
  ]);
});

test('keeps multi-tech queue rows active after the first assigned technician closes', async () => {
  let storedRow = {
    id: 42,
    user_id: 7,
    location_id: 'loc_1',
    status: 'seated',
    meta: {
      assignedAssignments: [
        { techName: 'Ruby123', boxIndex: 1, serviceName: 'Manicure', serviceIndex: 0 },
        { techName: 'Kerry', boxIndex: 2, serviceName: 'Pedicure', serviceIndex: 1 },
        { techName: 'Lior', boxIndex: 3, serviceName: 'Gel', serviceIndex: 2 },
        { techName: 'Mira', boxIndex: 4, serviceName: 'Polish', serviceIndex: 3 },
      ],
    },
  };
  const result = await completeQueueEntriesForClosedTicket({
    userId: 7,
    locationId: 'loc_1',
    closedAt: '2026-05-16T18:30:00.000Z',
    completedBy: 'checkout',
    ticketSnapshot: {
      id: 'ticket_ruby',
      ticketCode: 1042,
      customer: { queueEntryId: 42 },
      techs: [{ tech: 'Ruby123', services: [{ name: 'Manicure' }] }],
    },
    query: async (sql, params) => {
      if (/SELECT \*/i.test(sql) && /id = ANY/i.test(sql)) {
        return { rows: [storedRow] };
      }
      if (/UPDATE customer_queue_entries/i.test(sql)) {
        if (/status = 'completed'/i.test(sql)) {
          storedRow = {
            ...storedRow,
            status: 'completed',
            completed_at: new Date(params[2]),
            completed_ticket_id: params[3],
            completed_ticket_code: params[4],
            completed_by: params[5],
          };
          return { rows: [storedRow] };
        }
        storedRow = {
          ...storedRow,
          meta: JSON.parse(params[2]),
          updated_at: new Date('2026-05-16T18:30:00.000Z'),
        };
        return { rows: [storedRow] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  });

  assert.equal(result.attempted, true);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.updatedCount, 0);
  assert.equal(result.completedCount, 0);
  assert.equal(result.assignmentUpdatedCount, 1);
  assert.equal(storedRow.status, 'seated');
  assert.equal(storedRow.meta.assignedAssignments[0].completedTicketId, 'ticket_ruby');
  assert.equal(storedRow.meta.assignedAssignments[0].completedTicketCode, 1042);
  assert.equal(storedRow.meta.assignedAssignments[0].completedBy, 'checkout');
  assert.equal(storedRow.meta.assignedAssignments[1].completedTicketId, undefined);
  assert.equal(storedRow.meta.assignedAssignments[2].completedTicketId, undefined);
  assert.equal(storedRow.meta.assignedAssignments[3].completedTicketId, undefined);
});

test('completes multi-tech queue rows only after the final assigned technician closes', async () => {
  let storedRow = {
    id: 42,
    user_id: 7,
    location_id: 'loc_1',
    status: 'seated',
    meta: {
      assignedAssignments: [
        {
          techName: 'Ruby123',
          boxIndex: 1,
          serviceName: 'Manicure',
          serviceIndex: 0,
          completedAt: '2026-05-16T18:30:00.000Z',
          completedTicketId: 'ticket_ruby',
          completedTicketCode: 1042,
          completedBy: 'checkout',
        },
        { techName: 'Kerry', boxIndex: 2, serviceName: 'Pedicure', serviceIndex: 1 },
      ],
    },
  };
  const result = await completeQueueEntriesForClosedTicket({
    userId: 7,
    locationId: 'loc_1',
    closedAt: '2026-05-16T19:00:00.000Z',
    completedBy: 'checkout',
    ticketSnapshot: {
      id: 'ticket_kelly',
      ticketCode: 1043,
      customer: { queueEntryId: 42 },
      techs: [{ tech: 'Kerry', services: [{ name: 'Pedicure' }] }],
    },
    query: async (sql, params) => {
      if (/SELECT \*/i.test(sql) && /id = ANY/i.test(sql)) {
        return { rows: [storedRow] };
      }
      if (/UPDATE customer_queue_entries/i.test(sql)) {
        const metaParam = params.find((param) => typeof param === 'string' && param.includes('assignedAssignments'));
        storedRow = {
          ...storedRow,
          ...(metaParam ? { meta: JSON.parse(metaParam) } : {}),
          status: /status = 'completed'/i.test(sql) ? 'completed' : storedRow.status,
          completed_at: /status = 'completed'/i.test(sql) ? new Date(params[2]) : storedRow.completed_at,
          completed_ticket_id: /status = 'completed'/i.test(sql) ? params[3] : storedRow.completed_ticket_id,
          completed_ticket_code: /status = 'completed'/i.test(sql) ? params[4] : storedRow.completed_ticket_code,
          completed_by: /status = 'completed'/i.test(sql) ? params[5] : storedRow.completed_by,
        };
        return { rows: [storedRow] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  });

  assert.equal(result.attempted, true);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.updatedCount, 1);
  assert.equal(result.completedCount, 1);
  assert.equal(result.assignmentUpdatedCount, 1);
  assert.equal(storedRow.status, 'completed');
  assert.equal(storedRow.meta.assignedAssignments[0].completedTicketId, 'ticket_ruby');
  assert.equal(storedRow.meta.assignedAssignments[1].completedTicketId, 'ticket_kelly');
  assert.equal(storedRow.meta.assignedAssignments[1].completedTicketCode, 1043);
  assert.equal(result.completedRows[0]?.id, 42);
});

test('does not query or match completed queue rows from customer name alone', async () => {
  const calls = [];
  const result = await completeQueueEntriesForClosedTicket({
    userId: 7,
    locationId: 'loc_1',
    ticketSnapshot: {
      ticketCode: 1043,
      customer: { name: 'Same Name' },
    },
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
  });

  assert.equal(result.attempted, false);
  assert.equal(result.completedCount, 0);
  assert.equal(calls.length, 0);
});

test('uses phone and name fallback only when it resolves to one active queue row', async () => {
  const calls = [];
  const result = await completeQueueEntriesForClosedTicket({
    userId: 7,
    locationId: 'loc_1',
    closedAt: '2026-05-16T20:00:00.000Z',
    ticketSnapshot: {
      id: 'ticket_2',
      ticketCode: 1044,
      customer: {
        name: 'Arlo',
        phone: '(555) 333-2222',
      },
    },
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/status IN \('waiting', 'seated'\)/i.test(sql)) {
        return {
          rows: [{
            id: 51,
            user_id: 7,
            location_id: 'loc_1',
            status: 'waiting',
            name: 'arlo',
            phone_digits: '5553332222',
          }],
        };
      }
      if (/UPDATE customer_queue_entries/i.test(sql)) {
        return {
          rows: [{
            id: 51,
            status: 'completed',
            completed_at: new Date(params[2]),
            completed_ticket_id: params[3],
            completed_ticket_code: params[4],
          }],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  });

  assert.equal(result.attempted, true);
  assert.equal(result.updatedCount, 1);
  assert.equal(result.completedRows[0]?.id, 51);
  assert.deepEqual(calls[1].params[6], [51]);
});
