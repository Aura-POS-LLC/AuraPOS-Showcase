import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPhoneLookupKeys,
  canonicalUsPhone10,
  digitsOnlyPhone,
  phoneMatches,
} from '../src/phone-match.js';

test('digitsOnlyPhone strips non-digits and preserves raw digit order', () => {
  assert.equal(digitsOnlyPhone('(303) 555-7890'), '3035557890');
  assert.equal(digitsOnlyPhone('+1 (303) 555-7890'), '13035557890');
});

test('canonicalUsPhone10 normalizes +1 prefixed phone digits', () => {
  assert.equal(canonicalUsPhone10('13035557890'), '3035557890');
  assert.equal(canonicalUsPhone10('3035557890'), '3035557890');
  assert.equal(canonicalUsPhone10('0013035557890'), '3035557890');
});

test('buildPhoneLookupKeys includes both full and canonical lookup variants', () => {
  const keys = buildPhoneLookupKeys('+1 (303) 555-7890');
  assert.ok(keys.includes('13035557890'));
  assert.ok(keys.includes('3035557890'));
});

test('phoneMatches treats 10-digit and +1 variants as the same phone', () => {
  assert.equal(phoneMatches('3035557890', '13035557890'), true);
  assert.equal(phoneMatches('(303) 555-7890', '+1 303-555-7890'), true);
  assert.equal(phoneMatches('3035557890', '7205557890'), false);
});
