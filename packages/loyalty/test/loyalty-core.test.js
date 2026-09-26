import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyLoyaltyDeltaToBalance,
  hasExistingLoyaltyRedemption,
  hasExistingLoyaltyEarnEvent,
  hasExistingLoyaltyEarnReversal,
  calculateExpirablePointsFromLedgerEntries,
} from '../src/loyalty-core.js';

test('applyLoyaltyDeltaToBalance adds points', () => {
  const next = applyLoyaltyDeltaToBalance(120, 35);
  assert.equal(next, 155);
});

test('applyLoyaltyDeltaToBalance deducts points when balance is sufficient', () => {
  const next = applyLoyaltyDeltaToBalance(120, -20);
  assert.equal(next, 100);
});

test('applyLoyaltyDeltaToBalance rejects deductions below zero', () => {
  assert.throws(
    () => applyLoyaltyDeltaToBalance(40, -55),
    (err) => err?.status === 400 && /Insufficient points/i.test(err?.message || '')
  );
});

test('hasExistingLoyaltyRedemption detects applied ticket redemption idempotency', () => {
  assert.equal(hasExistingLoyaltyRedemption([]), false);
  assert.equal(
    hasExistingLoyaltyRedemption([
      { id: 11, status: 'applied' },
    ]),
    true
  );
  assert.equal(
    hasExistingLoyaltyRedemption([
      { id: 12, status: 'reversed' },
    ]),
    false
  );
});

test('hasExistingLoyaltyEarnEvent and hasExistingLoyaltyEarnReversal detect idempotency rows', () => {
  assert.equal(hasExistingLoyaltyEarnEvent([]), false);
  assert.equal(hasExistingLoyaltyEarnEvent([{ id: 33 }]), true);
  assert.equal(hasExistingLoyaltyEarnReversal([{ id: 44 }]), true);
});

test('calculateExpirablePointsFromLedgerEntries computes old unspent points via FIFO lots', () => {
  const entries = [
    { delta: 200, created_at: '2025-01-10T00:00:00.000Z' }, // old lot
    { delta: 100, created_at: '2026-02-10T00:00:00.000Z' }, // fresh lot
    { delta: -50, created_at: '2026-02-20T00:00:00.000Z' }, // consumes old lot first
  ];
  const expirable = calculateExpirablePointsFromLedgerEntries(entries, '2026-01-01T00:00:00.000Z');
  assert.equal(expirable, 150);
});

test('calculateExpirablePointsFromLedgerEntries is idempotent after an expire event is posted', () => {
  const entries = [
    { delta: 180, created_at: '2025-01-05T00:00:00.000Z' }, // old lot
    { delta: -180, created_at: '2026-02-01T00:00:00.000Z' }, // expire event
  ];
  const expirable = calculateExpirablePointsFromLedgerEntries(entries, '2026-01-01T00:00:00.000Z');
  assert.equal(expirable, 0);
});
