import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPhoneLookupKeys,
  canonicalUsPhone10,
  digitsOnlyPhone,
  phoneMatches,
} from '../src/phone-match.js';

test('digitsOnlyPhone strips non-digits and preserves raw digit order', () => {
  assert.equal(digitsOnlyPhone('(303) 555-0100'), '3035550100');
  assert.equal(digitsOnlyPhone('+1 (303) 555-0100'), '13035550100');
});

test('canonicalUsPhone10 normalizes +1 prefixed phone digits', () => {
  assert.equal(canonicalUsPhone10('13035550100'), '3035550100');
  assert.equal(canonicalUsPhone10('3035550100'), '3035550100');
  assert.equal(canonicalUsPhone10('0013035550100'), '3035550100');
});

test('buildPhoneLookupKeys includes both full and canonical lookup variants', () => {
  const keys = buildPhoneLookupKeys('+1 (303) 555-0100');
  assert.ok(keys.includes('13035550100'));
  assert.ok(keys.includes('3035550100'));
});

test('phoneMatches treats 10-digit and +1 variants as the same phone', () => {
  assert.equal(phoneMatches('3035550100', '13035550100'), true);
  assert.equal(phoneMatches('(303) 555-0100', '+1 303-555-0100'), true);
  assert.equal(phoneMatches('3035550100', '7205550100'), false);
});
