import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTechnicianRecord,
  isActiveQueueEntryForBoardSync,
  signInTechnician,
  signOutTechnician,
} from '../src/sync/turn-manager-state.js';

const mockSettings = {
  servicesById: { svc: { name: 'Dip' } },
  technicians: [{ name: 'Ida', skillIds: ['svc'] }],
};

test('buildTechnicianRecord seeds boxes and skills', () => {
  const rec = buildTechnicianRecord({ name: 'Ida', boxCount: 2, settings: mockSettings, now: 123 });
  assert.equal(rec.name, 'Ida');
  assert.equal(rec.boxes.length, 2);
  assert.equal(rec.checkInAt, 123);
  assert.deepEqual(rec.skills, ['Dip']);
});

test('buildTechnicianRecord optionally adds late turn', () => {
  const rec = buildTechnicianRecord({ name: 'Ida', boxCount: 1, settings: mockSettings, includeLateTurn: true });
  assert.equal(rec.boxes[0]?.name, 'Late');
});

test('signInTechnician appends technician and removes from pool', () => {
  const state = { technicians: [], signInPool: ['Ida'] };
  const result = signInTechnician(state, 'Ida', { boxCount: 1, settings: mockSettings });
  assert.equal(result.technicians.length, 1);
  assert.equal(result.signInPool.includes('Ida'), false);
});

test('signOutTechnician removes technician and returns name to sign-in pool', () => {
  const state = {
    technicians: [{ name: 'Ida', boxes: [], checkInAt: 1, skipped: false, skills: [] }],
    signInPool: [],
  };
  const result = signOutTechnician(state, 'Ida', { signInPoolDefault: ['Ida', 'Anya'] });
  assert.equal(result.technicians.length, 0);
  assert.deepEqual(result.signInPool, ['Ida', 'Anya']);
  assert.equal(result.removed?.name, 'Ida');
});

test('signOutTechnician does not duplicate existing pool names', () => {
  const state = {
    technicians: [{ name: 'Ida', boxes: [], checkInAt: 1, skipped: false, skills: [] }],
    signInPool: ['Ida'],
  };
  const result = signOutTechnician(state, 'ida', { signInPoolDefault: ['Ida'] });
  assert.equal(result.technicians.length, 0);
  assert.deepEqual(result.signInPool, ['Ida']);
});

test('signOutTechnician restores sign-in pool using default roster order', () => {
  const state = {
    technicians: [{ name: 'Ida', boxes: [], checkInAt: 1, skipped: false, skills: [] }],
    signInPool: ['Zoe', 'Anya'],
  };
  const result = signOutTechnician(state, 'Ida', { signInPoolDefault: ['Anya', 'Ida', 'Zoe'] });
  assert.equal(result.technicians.length, 0);
  assert.deepEqual(result.signInPool, ['Anya', 'Ida', 'Zoe']);
});

test('signOutTechnician is a no-op when technician is missing', () => {
  const state = {
    technicians: [{ name: 'Anya', boxes: [], checkInAt: 1, skipped: false, skills: [] }],
    signInPool: [],
  };
  const result = signOutTechnician(state, 'Ida', { signInPoolDefault: ['Ida'] });
  assert.equal(result.technicians.length, 1);
  assert.equal(result.removed, null);
  assert.deepEqual(result.signInPool, []);
});

test('board reconciliation accepts only waiting and seated queue entries', () => {
  assert.equal(isActiveQueueEntryForBoardSync({ status: 'waiting' }), true);
  assert.equal(isActiveQueueEntryForBoardSync({ status: 'SEATED' }), true);
  assert.equal(isActiveQueueEntryForBoardSync({ status: 'completed' }), false);
  assert.equal(isActiveQueueEntryForBoardSync({ status: 'removed' }), false);
  assert.equal(isActiveQueueEntryForBoardSync({}), false);
});
