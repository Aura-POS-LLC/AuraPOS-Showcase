import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveTicketItemType,
  isTicketItemProduct,
} from '../src/ticket-item-classification.js';

const serviceLookups = {
  byId: new Map([['svc_ja', {}], ['shared_id', {}]]),
  byName: new Map([['ja', {}], ['shared name', {}]]),
};

const productLookups = {
  byId: new Map([['prod_ja', {}], ['shared_id', {}]]),
  byName: new Map([['retail ja', {}], ['shared name', {}], ['ja', {}]]),
};

test('explicit item types override catalog collisions', () => {
  assert.equal(resolveTicketItemType(
    { id: 'prod_ja', name: 'ja', itemType: 'service' },
    { serviceLookups, productLookups }
  ), 'service');
  assert.equal(resolveTicketItemType(
    { id: 'svc_ja', name: 'ja', itemType: 'product' },
    { serviceLookups, productLookups }
  ), 'product');
});

test('legacy fields are honored before catalog inference', () => {
  assert.equal(resolveTicketItemType({ type: 'product' }), 'product');
  assert.equal(resolveTicketItemType({ type: 'service' }), 'service');
  assert.equal(resolveTicketItemType({ isProduct: true }), 'product');
  assert.equal(resolveTicketItemType({ isProduct: false }), 'service');
});

test('legacy catalog inference prefers service for ID and name collisions', () => {
  assert.equal(resolveTicketItemType(
    { id: 'shared_id', name: 'shared name' },
    { serviceLookups, productLookups }
  ), 'service');
  assert.equal(resolveTicketItemType(
    { id: 'prod_ja', name: 'Retail JA' },
    { serviceLookups, productLookups }
  ), 'product');
  assert.equal(resolveTicketItemType(
    { id: 'unknown', name: 'ja' },
    { serviceLookups, productLookups }
  ), 'service');
});

test('invalid or unknown legacy lines default to service', () => {
  assert.equal(resolveTicketItemType({ itemType: 'retail' }), 'service');
  assert.equal(resolveTicketItemType(null), 'service');
  assert.equal(isTicketItemProduct({ itemType: 'product' }), true);
  assert.equal(isTicketItemProduct({ itemType: 'service' }), false);
});
