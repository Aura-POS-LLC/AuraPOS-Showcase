import test from 'node:test';
import assert from 'node:assert/strict';

import { createCheckoutTicketsSingleFlightLoader } from '../src/checkout-tickets-singleflight.js';

test('singleflight dedupes concurrent loads per tenant key', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const loader = createCheckoutTicketsSingleFlightLoader(async () => {
    calls += 1;
    await gate;
    return { ok: true };
  });

  const p1 = loader(7, 'loc_1');
  const p2 = loader(7, 'loc_1');
  assert.equal(loader.inFlightSize(), 1);
  release();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.deepEqual(r1, { ok: true });
  assert.deepEqual(r2, { ok: true });
  assert.equal(calls, 1);
  assert.equal(loader.inFlightSize(), 0);
});

test('singleflight does not dedupe across different tenant keys', async () => {
  let calls = 0;
  const loader = createCheckoutTicketsSingleFlightLoader(async (_userId, locationId) => {
    calls += 1;
    return { locationId };
  });

  const [a, b] = await Promise.all([
    loader(7, 'loc_1'),
    loader(7, 'loc_2'),
  ]);

  assert.equal(calls, 2);
  assert.equal(a.locationId, 'loc_1');
  assert.equal(b.locationId, 'loc_2');
});

test('singleflight clears in-flight entry after error', async () => {
  let calls = 0;
  const loader = createCheckoutTicketsSingleFlightLoader(async () => {
    calls += 1;
    throw new Error('boom');
  });

  await assert.rejects(loader(7, 'loc_1'), /boom/);
  assert.equal(loader.inFlightSize(), 0);
  await assert.rejects(loader(7, 'loc_1'), /boom/);
  assert.equal(calls, 2);
});
