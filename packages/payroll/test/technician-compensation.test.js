import test from 'node:test';
import assert from 'node:assert/strict';
import { attachTechnicianCompensation, resolveCommissionPercent, resolveLaundryFee } from '../src/technician-compensation.js';
import { validateTechnicianWriteShape, persistSettingsWithTechnicianSync } from '../src/settings-technicians.js';

test('commission preserves zero, decimal and one percent and migrates legacy fractions', () => {
  for (const percent of [0, 0.5, 1, 60, 62.5, 100]) {
    assert.equal(resolveCommissionPercent({ commissionPercent: percent, percent: 90 }), percent);
  }
  assert.equal(resolveCommissionPercent({ percent: 0.6 }), 60);
  assert.equal(resolveCommissionPercent({ commissionPercent: null }), 60);
  assert.equal(resolveCommissionPercent({}, 70), 70);
  assert.equal(resolveLaundryFee({ laundryFee: '2.50' }), 2.5);
});

test('compensation survives save, table sync, reload, and technician rename without restoring deleted roster rows', async () => {
  let saved;
  await persistSettingsWithTechnicianSync({
    userId: 1,
    mergedPayload: { technicians: [{ id: 'a', name: 'Aster', commissionPercent: '62.5', laundryFee: '3.75', guarantee: '3000.25' }] },
    syncTechniciansTable: async () => [{ id: 'a', techCode: '12345678' }],
    writeSettingsPayload: async payload => { saved = JSON.parse(JSON.stringify(payload)); },
  });
  saved.technicians.push({ id: 'deleted', name: 'Removed', commissionPercent: 90 });
  const read = attachTechnicianCompensation([{ id: 'a', name: 'Renamed' }], saved.technicians);
  assert.equal(read.length, 1);
  assert.equal(read[0].name, 'Renamed');
  assert.equal(read[0].commissionPercent, 62.5);
  assert.equal(read[0].laundryFee, 3.75);
  assert.equal(read[0].guarantee, 3000.25);
  assert.equal(attachTechnicianCompensation([{ id: 'new', name: 'Aster' }], saved.technicians)[0].commissionPercent, null);
});

test('settings reject invalid compensation and allow clearing the rate', () => {
  for (const [field, value] of [['commissionPercent', -1], ['commissionPercent', 101], ['commissionPercent', true], ['laundryFee', -1], ['laundryFee', 'abc'], ['laundryFee', Infinity], ['guarantee', -1], ['guarantee', 'abc'], ['guarantee', Infinity], ['guarantee', true], ['guarantee', 1000001]]) {
    assert.throws(() => validateTechnicianWriteShape([{ id: 'a', name: 'A', [field]: value }]), /must be a number/);
  }
  const [tech] = validateTechnicianWriteShape([{ id: 'a', name: 'A', commissionPercent: '', laundryFee: '0' }]);
  assert.equal(tech.commissionPercent, null);
  assert.equal(tech.laundryFee, 0);
});

test('older roster writes preserve omitted compensation, and clearing removes legacy overrides', async () => {
  const { preserveTechnicianCompensation } = await import('../src/technician-compensation.js');
  const saved = [{ id: 'a', name: 'A', commissionPercent: 70, laundryFee: 5, guarantee: 3000 }];
  const [preserved] = preserveTechnicianCompensation([{ id: 'a', name: 'Renamed' }], saved);
  assert.equal(preserved.commissionPercent, 70);
  assert.equal(preserved.laundryFee, 5);
  assert.equal(preserved.guarantee, 3000);
  const [cleared] = validateTechnicianWriteShape(preserveTechnicianCompensation([{ id: 'a', name: 'A', commissionPercent: null, percent: 80, laundryFee: 0, guarantee: 0 }], saved));
  assert.equal(resolveCommissionPercent(cleared, 60), 60);
  assert.equal(cleared.laundryFee, 0);
  assert.equal(cleared.guarantee, 0);
});
