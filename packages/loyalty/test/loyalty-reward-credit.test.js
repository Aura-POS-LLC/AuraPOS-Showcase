import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateLoyaltyRewardCredit,
  normalizeLoyaltyRewardType,
} from '../src/loyalty-reward-credit.js';

test('normalizeLoyaltyRewardType falls back to amount_off for unknown values', () => {
  assert.equal(normalizeLoyaltyRewardType('weird_type'), 'amount_off');
});

test('calculateLoyaltyRewardCredit returns 0 when base amount is zero', () => {
  const discount = calculateLoyaltyRewardCredit({
    rewardType: 'amount_off',
    rewardValue: 10,
    baseAmount: 0,
    maxPerRedemption: null,
  });
  assert.equal(discount, 0);
});

test('calculateLoyaltyRewardCredit computes amount_off and caps by base', () => {
  const discount = calculateLoyaltyRewardCredit({
    rewardType: 'amount_off',
    rewardValue: 25,
    baseAmount: 12,
    maxPerRedemption: null,
  });
  assert.equal(discount, 12);
});

test('calculateLoyaltyRewardCredit computes fixed_service and fixed_product as direct discount values', () => {
  const fixedService = calculateLoyaltyRewardCredit({
    rewardType: 'fixed_service',
    rewardValue: 15,
    baseAmount: 50,
    maxPerRedemption: null,
  });
  const fixedProduct = calculateLoyaltyRewardCredit({
    rewardType: 'fixed_product',
    rewardValue: 8,
    baseAmount: 50,
    maxPerRedemption: null,
  });
  assert.equal(fixedService, 15);
  assert.equal(fixedProduct, 8);
});

test('calculateLoyaltyRewardCredit computes percent_off with max cap', () => {
  const discount = calculateLoyaltyRewardCredit({
    rewardType: 'percent_off',
    rewardValue: 25,
    baseAmount: 100,
    maxPerRedemption: 12,
  });
  assert.equal(discount, 12);
});

test('net amount due from reward credit is never below zero', () => {
  const baseAmount = 9;
  const reward = calculateLoyaltyRewardCredit({
    rewardType: 'amount_off',
    rewardValue: 20,
    baseAmount,
    maxPerRedemption: null,
  });
  const amountDue = Math.max(0, Math.round((baseAmount - reward) * 100) / 100);
  assert.equal(amountDue, 0);
});
