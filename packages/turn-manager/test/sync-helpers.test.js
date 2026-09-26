import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeServiceOrderMode,
  orderedServiceIds,
  serviceNamesFromSettings,
  skillNamesForTech,
  technicianCanPerformService,
  deriveQueueAssignedServiceIndexes,
  resolveSelectedQueueServicesForAssignment,
  resolveQueueServiceCompletionState,
  toggleQueueServiceCompletionOverride,
  resolveAppointmentsForQueueEntry,
  buildAppointmentRequestMetadata,
} from '../src/sync/turn-manager-helpers.js';

test('normalizeServiceOrderMode defaults to manual', () => {
  assert.equal(normalizeServiceOrderMode(undefined), 'manual');
  assert.equal(normalizeServiceOrderMode('Turns_Desc'), 'turns_desc');
});

test('orderedServiceIds sorts by turns then name', () => {
  const settings = {
    serviceOrderMode: 'turns_asc',
    servicesById: {
      a: { name: 'Dip', turns: 1 },
      b: { name: 'Gel', turns: 0.5 },
      c: { name: 'Mani', turns: 0.5 },
    },
  };
  const section = { serviceIds: ['a', 'b', 'c'] };
  assert.deepEqual(orderedServiceIds(section, settings), ['b', 'c', 'a']);
});

test('serviceNamesFromSettings honors showOnBoard flag', () => {
  const settings = {
    sections: [{ serviceIds: ['a', 'b'] }],
    servicesById: {
      a: { name: 'Dip', showOnBoard: true },
      b: { name: 'Gel', showOnBoard: false },
    },
  };
  assert.deepEqual(serviceNamesFromSettings(settings), ['Dip']);
});

test('skillNamesForTech falls back to all services if no skills configured', () => {
  const settings = {
    sections: [{ serviceIds: ['a'] }],
    servicesById: { a: { name: 'Dip' }, b: { name: 'Gel' } },
    technicians: [{ name: 'Ida', skillIds: [] }],
  };
  assert.deepEqual(skillNamesForTech('Ida', settings), ['Dip', 'Gel']);
  assert.deepEqual(skillNamesForTech('Unknown', settings), ['Dip']);
});

test('technicianCanPerformService uses settings skillIds to detect unsupported services', () => {
  const settings = {
    sections: [
      { id: 'sec_mani', name: 'Manicure', serviceIds: ['svc_dip'] },
      { id: 'sec_pedi', name: 'Pedicure', serviceIds: ['svc_pedi'] },
    ],
    servicesById: {
      svc_dip: { id: 'svc_dip', name: 'Dip' },
      svc_pedi: { id: 'svc_pedi', name: 'Pedicure' },
    },
    technicians: [
      { id: 'tech_ivy', name: 'Ida', skillIds: ['svc_dip'] },
      { id: 'tech_open', name: 'Open', skillIds: [] },
    ],
  };

  assert.equal(technicianCanPerformService({ name: 'Ida' }, { id: 'svc_dip', name: 'Dip' }, settings), true);
  assert.equal(technicianCanPerformService({ name: 'Ida' }, { id: 'svc_pedi', name: 'Pedicure' }, settings), false);
  assert.equal(technicianCanPerformService({ name: 'Open' }, { id: 'svc_pedi', name: 'Pedicure' }, settings), true);
  assert.equal(technicianCanPerformService({ name: 'Missing', skills: ['Pedicure'] }, { name: 'Pedicure' }, settings), true);
});

test('deriveQueueAssignedServiceIndexes consumes duplicate service labels one-per-assignment', () => {
  const services = [{ service: 'Gel Pedi' }, { service: 'Gel Pedi' }, { service: 'Fullset' }];
  const assignments = [
    { serviceName: 'Gel Pedi' },
    { serviceName: 'Gel Pedi' },
  ];
  const completed = deriveQueueAssignedServiceIndexes(services, assignments);
  assert.deepEqual([...completed].sort((a, b) => a - b), [0, 1]);
});

test('explicit assignment serviceIndex takes precedence over serviceName fallback', () => {
  const services = [{ service: 'Gel Pedi' }, { service: 'Gel Pedi' }];
  const assignments = [{ serviceName: 'Gel Pedi', serviceIndex: 1 }];
  const completed = deriveQueueAssignedServiceIndexes(services, assignments);
  assert.deepEqual([...completed], [1]);
});

test('selected multi-service assignment rows carry distinct service indexes', () => {
  const services = [{ service: 'Gel Mani' }, { service: 'Pedicure' }, { service: 'Fullset' }];
  const selected = resolveSelectedQueueServicesForAssignment({
    services,
    serviceChoices: [
      { key: 'appt_a', serviceKey: 'gel mani', label: 'Gel Mani' },
      { key: 'appt_b', serviceKey: 'pedicure', label: 'Pedicure' },
      { key: 'appt_c', serviceKey: 'fullset', label: 'Fullset' },
    ],
    selectedKeys: ['appt_a', 'appt_b'],
  });
  assert.deepEqual(selected, [
    { serviceName: 'Gel Mani', serviceIndex: 0 },
    { serviceName: 'Pedicure', serviceIndex: 1 },
  ]);

  const completed = resolveQueueServiceCompletionState({
    services,
    assignments: selected,
    overrides: {},
  });
  assert.deepEqual([...completed.finalCompleted].sort((a, b) => a - b), [0, 1]);
});

test('selected service resolver skips already assigned duplicate service indexes', () => {
  const services = [{ service: 'Gel Pedi' }, { service: 'Gel Pedi' }, { service: 'Fullset' }];
  const selected = resolveSelectedQueueServicesForAssignment({
    services,
    serviceChoices: [
      { key: 'entry:gel pedi:1', serviceKey: 'gel pedi', label: 'Gel Pedi' },
    ],
    selectedKeys: ['entry:gel pedi:1'],
    existingAssignments: [{ serviceName: 'Gel Pedi', serviceIndex: 0 }],
  });
  assert.deepEqual(selected, [
    { serviceName: 'Gel Pedi', serviceIndex: 1 },
  ]);
});

test('toggleQueueServiceCompletionOverride removes override when toggled back to base state', () => {
  const services = [{ service: 'Gel Pedi' }, { service: 'Fullset' }];
  const assignments = [{ serviceName: 'Gel Pedi' }];

  const initial = resolveQueueServiceCompletionState({ services, assignments, overrides: {} });
  assert.equal(initial.finalCompleted.has(0), true);
  assert.equal(initial.finalCompleted.has(1), false);

  const toggledOn = toggleQueueServiceCompletionOverride({
    services,
    assignments,
    overrides: initial.overrides,
    serviceIndex: 1,
  });
  assert.equal(toggledOn.finalCompleted.has(1), true);
  assert.deepEqual(toggledOn.overrides, { 1: true });

  const toggledBack = toggleQueueServiceCompletionOverride({
    services,
    assignments,
    overrides: toggledOn.overrides,
    serviceIndex: 1,
  });
  assert.equal(toggledBack.finalCompleted.has(1), false);
  assert.deepEqual(toggledBack.overrides, {});
});

test('buildAppointmentRequestMetadata preserves same-phone request technicians without non-request rows', () => {
  const requests = buildAppointmentRequestMetadata([
    {
      id: 'appt_heily',
      date: '2026-05-20',
      name: 'Silas',
      phone: '3035556795',
      startMin: 90,
      service: 'Pedi/Fs/F',
      sid: 'svc_pedi_fs',
      tech: 'Hana',
      techId: 'tech_heily',
      visitType: 'online-request',
    },
    {
      id: 'appt_kellyiante',
      date: '2026-05-20',
      name: 'Silas',
      phone: '3035556795',
      startMin: 90,
      service: 'Pedi/Tap',
      sid: 'svc_pedi_tap',
      tech: 'Kerryiante',
      techId: 'tech_kellyiante',
      visitType: 'online-request',
    },
    {
      id: 'appt_walkin',
      date: '2026-05-20',
      name: 'Silas',
      phone: '3035556795',
      startMin: 120,
      service: 'Gel',
      tech: 'Anyone',
      visitType: 'online-non-request',
    },
  ]);

  assert.deepEqual(requests, [
    {
      visitType: 'online-request',
      techName: 'Hana',
      serviceName: 'Pedi/Fs/F',
      appointmentId: 'appt_heily',
      serviceId: 'svc_pedi_fs',
      techId: 'tech_heily',
      date: '2026-05-20',
      startMin: 90,
    },
    {
      visitType: 'online-request',
      techName: 'Kerryiante',
      serviceName: 'Pedi/Tap',
      appointmentId: 'appt_kellyiante',
      serviceId: 'svc_pedi_tap',
      techId: 'tech_kellyiante',
      date: '2026-05-20',
      startMin: 90,
    },
  ]);
});

test('resolveAppointmentsForQueueEntry uses appointment ids before duplicate names', () => {
  const dateKey = '2026-05-03';
  const appointments = [
    { id: 'appt_old', date: dateKey, name: 'Avery', phone: '5551112222', startMin: 60, service: 'Gel' },
    { id: 'appt_target', date: dateKey, name: 'Avery', phone: '5553334444', startMin: 60, service: 'Dip' },
  ];
  const matches = resolveAppointmentsForQueueEntry({
    appointments,
    dateKey,
    entry: {
      name: 'Avery',
      phoneDigits: '5553334444',
      appointmentDate: dateKey,
      appointmentTimeMinutes: 60,
      appointmentId: 'appt_target',
    },
  });
  assert.deepEqual(matches.map((item) => item.id), ['appt_target']);
});

test('resolveAppointmentsForQueueEntry treats phone as stronger than same-name fallback', () => {
  const dateKey = '2026-05-03';
  const appointments = [
    { id: 'appt_old', date: dateKey, name: 'Avery', phone: '5551112222', startMin: 60, service: 'Gel' },
    { id: 'appt_target', date: dateKey, name: 'Avery', phone: '5553334444', startMin: 60, service: 'Dip' },
  ];
  const matches = resolveAppointmentsForQueueEntry({
    appointments,
    dateKey,
    entry: {
      name: 'Avery',
      phoneDigits: '5553334444',
      appointmentDate: dateKey,
      appointmentTimeMinutes: 60,
    },
  });
  assert.deepEqual(matches.map((item) => item.id), ['appt_target']);
});

test('resolveAppointmentsForQueueEntry canonicalizes phone digits for new-customer matching', () => {
  const dateKey = '2026-05-03';
  const appointments = [
    { id: 'appt_target', date: dateKey, name: 'Avery', phone: '(555) 333-4444', startMin: 60, service: 'Dip' },
  ];
  const matches = resolveAppointmentsForQueueEntry({
    appointments,
    dateKey,
    entry: {
      name: 'Avery',
      phoneDigits: '15553334444',
      appointmentDate: dateKey,
      appointmentTimeMinutes: 60,
    },
  });
  assert.deepEqual(matches.map((item) => item.id), ['appt_target']);
});

test('resolveAppointmentsForQueueEntry does not fall back to same name when phone is present but unmatched', () => {
  const dateKey = '2026-05-03';
  const appointments = [
    { id: 'appt_old', date: dateKey, name: 'Avery', phone: '5551112222', startMin: 60, service: 'Gel' },
  ];
  const matches = resolveAppointmentsForQueueEntry({
    appointments,
    dateKey,
    entry: {
      name: 'Avery',
      phoneDigits: '5553334444',
      appointmentDate: dateKey,
      appointmentTimeMinutes: 60,
    },
  });
  assert.deepEqual(matches, []);
});

test('resolveAppointmentsForQueueEntry falls through from missing customerId match to phone match', () => {
  const dateKey = '2026-05-03';
  const appointments = [
    { id: 'appt_target', date: dateKey, name: 'Avery', phone: '5553334444', startMin: 60, service: 'Dip' },
  ];
  const matches = resolveAppointmentsForQueueEntry({
    appointments,
    dateKey,
    entry: {
      name: 'Avery',
      phoneDigits: '5553334444',
      customerId: 101,
      appointmentDate: dateKey,
      appointmentTimeMinutes: 60,
    },
  });
  assert.deepEqual(matches.map((item) => item.id), ['appt_target']);
});

test('resolveAppointmentsForQueueEntry allows unique name fallback only when stronger identity is missing', () => {
  const dateKey = '2026-05-03';
  const appointments = [
    { id: 'appt_target', date: dateKey, name: 'Jules', startMin: 60, service: 'Dip' },
  ];
  const matches = resolveAppointmentsForQueueEntry({
    appointments,
    dateKey,
    entry: {
      name: 'Jules',
      appointmentDate: dateKey,
      appointmentTimeMinutes: 60,
    },
  });
  assert.deepEqual(matches.map((item) => item.id), ['appt_target']);
});
