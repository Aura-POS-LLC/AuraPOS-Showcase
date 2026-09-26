function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeExplicitType(value) {
  const normalized = normalizeKey(value);
  return normalized === 'service' || normalized === 'product' ? normalized : '';
}

function lookupHas(lookup, key) {
  return !!key && !!lookup && typeof lookup.has === 'function' && lookup.has(key);
}

export function resolveTicketItemType(item, {
  serviceLookups = null,
  productLookups = null,
} = {}) {
  if (!item || typeof item !== 'object') return 'service';

  const itemType = normalizeExplicitType(item.itemType);
  if (itemType) return itemType;

  const legacyType = normalizeExplicitType(item.type);
  if (legacyType) return legacyType;

  if (item.isProduct === true) return 'product';
  if (item.isProduct === false) return 'service';

  const idKey = normalizeKey(
    item.id || item.serviceId || item.service_id || item.productId || item.product_id
  );
  if (lookupHas(serviceLookups?.byId, idKey)) return 'service';
  if (lookupHas(productLookups?.byId, idKey)) return 'product';

  const nameKey = normalizeKey(
    item.name || item.serviceName || item.service_name || item.label
  );
  if (lookupHas(serviceLookups?.byName, nameKey)) return 'service';
  if (lookupHas(productLookups?.byName, nameKey)) return 'product';
  return 'service';
}

export function isTicketItemProduct(item, lookups = {}) {
  return resolveTicketItemType(item, lookups) === 'product';
}
