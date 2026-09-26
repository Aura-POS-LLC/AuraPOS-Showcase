import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTechServiceSummaryOptimized } from '../src/tech-service-summary.js';
import { isTicketItemProduct } from '../src/ticket-item-classification.js';

function buildTechServiceSummaryLegacy({
  finishedTickets,
  techKey,
  dateKey,
  offsetMinutes,
  serviceLookups,
  productLookups,
  ticketMatchesTechReportDate,
  getTechReportTicketDate,
  normalizeTechnicianName,
  isProductService,
  getTechReportLineTotalForTech,
  getTechReportLineDeductible,
  ticketNotificationLabel,
}) {
  const groups = [];
  let total = 0;
  let tipTotal = 0;
  let deductibleTotal = 0;
  if (!techKey) {
    return {
      groups: [],
      total: 0,
      tipTotal: 0,
      deductibleTotal: 0,
      totalWithDeductible: 0,
      totalWithDeductibleWithTip: 0,
    };
  }

  const sortedTickets = (finishedTickets || [])
    .filter((ticket) => ticketMatchesTechReportDate(ticket, dateKey, offsetMinutes))
    .slice()
    .sort((a, b) => {
      const aTime = getTechReportTicketDate(a)?.getTime() || 0;
      const bTime = getTechReportTicketDate(b)?.getTime() || 0;
      return aTime - bTime;
    });

  sortedTickets.forEach((ticket) => {
    const groupsForTicket = Array.isArray(ticket?.techs) ? ticket.techs : [];
    groupsForTicket.forEach((group) => {
      const groupKey = normalizeTechnicianName(group?.tech || '');
      if (!groupKey || groupKey !== techKey) return;

      const services = Array.isArray(group?.services)
        ? group.services.filter((svc) => !isProductService(svc, productLookups))
        : [];
      if (!services.length) return;

      const serviceLines = [];
      services.forEach((svc) => {
        const name = String(svc?.name || svc?.serviceName || 'Service').trim() || 'Service';
        const qty = Number.isFinite(svc?.qty) ? Math.max(1, svc.qty) : 1;
        const lineTotal = getTechReportLineTotalForTech(svc);
        const perUnitAmount = qty > 0 ? lineTotal / qty : lineTotal;
        const perUnitDeductible = getTechReportLineDeductible(svc, serviceLookups);
        for (let i = 0; i < qty; i += 1) {
          const deductible = Math.min(perUnitAmount, perUnitDeductible);
          serviceLines.push({
            name,
            amount: perUnitAmount,
            deductible,
          });
          total += perUnitAmount;
          deductibleTotal += Math.max(0, deductible);
        }
      });

      const tip = Number.isFinite(group?.tip) ? Math.max(0, group.tip) : 0;
      tipTotal += tip;

      const rawCustomer = ticket?.customer?.name || ticket?.customerName || '';
      const ticketLabel = ticketNotificationLabel(ticket);
      const customerName = String(rawCustomer).trim() || ticketLabel || 'Walk-in';
      const closedAt = getTechReportTicketDate(ticket);

      groups.push({
        customerName,
        closedAt: closedAt ? closedAt.toISOString() : null,
        services: serviceLines,
        tip,
      });
    });
  });

  const totalWithDeductible = Math.max(0, total - deductibleTotal);
  const totalWithDeductibleWithTip = totalWithDeductible + tipTotal;
  return {
    groups,
    total,
    tipTotal,
    deductibleTotal,
    totalWithDeductible,
    totalWithDeductibleWithTip,
  };
}

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = ((state * 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function randomInt(rand, min, max) {
  return min + Math.floor(rand() * ((max - min) + 1));
}

function maybe(rand, probability = 0.5) {
  return rand() < probability;
}

function buildFixture(seed) {
  const rand = makeRng(seed);
  const dateKeys = ['2026-03-07', '2026-03-06', '2026-02-28'];
  const techNames = ['anya', 'bob', 'cara', 'dylan'];
  const finishedTickets = [];

  const ticketCount = randomInt(rand, 10, 40);
  for (let t = 0; t < ticketCount; t += 1) {
    const dateKey = dateKeys[randomInt(rand, 0, dateKeys.length - 1)];
    const techGroupCount = randomInt(rand, 0, 4);
    const techs = [];
    for (let g = 0; g < techGroupCount; g += 1) {
      const tech = techNames[randomInt(rand, 0, techNames.length - 1)];
      const serviceCount = randomInt(rand, 0, 5);
      const services = [];
      for (let s = 0; s < serviceCount; s += 1) {
        const isProduct = maybe(rand, 0.25);
        const id = isProduct ? `prod-${randomInt(rand, 1, 5)}` : `svc-${randomInt(rand, 1, 15)}`;
        services.push({
          id,
          name: `Service ${randomInt(rand, 1, 25)}`,
          qty: maybe(rand, 0.8) ? randomInt(rand, 1, 4) : (maybe(rand) ? 0 : NaN),
          lineTotal: Number((rand() * 120).toFixed(2)),
          lineDeductible: Number((rand() * 15).toFixed(2)),
        });
      }
      techs.push({
        tech,
        tip: maybe(rand, 0.7) ? Number((rand() * 30).toFixed(2)) : 0,
        services,
      });
    }
    finishedTickets.push({
      id: `ticket-${seed}-${t}`,
      ticketCode: randomInt(rand, 100, 999),
      dateKey,
      closedAt: new Date(Date.UTC(2026, 2, randomInt(rand, 1, 28), randomInt(rand, 0, 23), randomInt(rand, 0, 59))).toISOString(),
      customerName: maybe(rand, 0.7) ? `Customer ${randomInt(rand, 1, 40)}` : '',
      techs,
    });
  }

  const deps = {
    ticketMatchesTechReportDate: (ticket, targetDateKey) => ticket?.dateKey === targetDateKey,
    getTechReportTicketDate: (ticket) => (ticket?.closedAt ? new Date(ticket.closedAt) : null),
    normalizeTechnicianName: (value) => String(value || '').trim().toLowerCase(),
    isProductService: (svc) => String(svc?.id || '').startsWith('prod-'),
    getTechReportLineTotalForTech: (svc) => {
      const value = Number(svc?.lineTotal);
      return Number.isFinite(value) ? Math.max(0, value) : 0;
    },
    getTechReportLineDeductible: (svc) => {
      const value = Number(svc?.lineDeductible);
      return Number.isFinite(value) ? value : 0;
    },
    ticketNotificationLabel: (ticket) => {
      if (Number.isFinite(ticket?.ticketCode)) return `#${Math.trunc(ticket.ticketCode)}`;
      if (ticket?.id) return `#${String(ticket.id).slice(-6)}`;
      return '';
    },
  };

  return { finishedTickets, deps };
}

test('buildTechServiceSummaryOptimized matches legacy output across random fixtures', () => {
  const targetTech = 'anya';
  for (let seed = 1; seed <= 75; seed += 1) {
    const { finishedTickets, deps } = buildFixture(seed);
    const input = {
      finishedTickets,
      techKey: targetTech,
      dateKey: '2026-03-07',
      offsetMinutes: 0,
      serviceLookups: {},
      productLookups: {},
      ...deps,
    };
    const legacy = buildTechServiceSummaryLegacy(input);
    const optimized = buildTechServiceSummaryOptimized(input);
    assert.deepEqual(optimized, legacy, `seed ${seed} should match legacy output`);
  }
});

test('buildTechServiceSummaryOptimized returns zeroed totals when techKey is missing', () => {
  const { finishedTickets, deps } = buildFixture(501);
  const result = buildTechServiceSummaryOptimized({
    finishedTickets,
    techKey: '',
    dateKey: '2026-03-07',
    offsetMinutes: 0,
    serviceLookups: {},
    productLookups: {},
    ...deps,
  });
  assert.deepEqual(result, {
    groups: [],
    total: 0,
    tipTotal: 0,
    deductibleTotal: 0,
    totalWithDeductible: 0,
    totalWithDeductibleWithTip: 0,
  });
});

test('historical service wins a product name collision while explicit product stays excluded', () => {
  const serviceLookups = {
    byId: new Map([['svc_ja', 0]]),
    byName: new Map([['ja', 0]]),
  };
  const productLookups = {
    byId: new Map([['prod_ja', {}]]),
    byName: new Map([['ja', {}]]),
  };
  const result = buildTechServiceSummaryOptimized({
    finishedTickets: [{
      ticketCode: 810067,
      dateKey: '2026-06-26',
      closedAt: '2026-06-26T23:41:00.000Z',
      customerName: 'Walk-in',
      techs: [{
        tech: 'vivian',
        tip: 0,
        services: [
          { id: 'svc_ja', name: 'ja', price: 13, qty: 1 },
          { id: 'svc_ja', name: 'ja', price: 99, qty: 1, itemType: 'product' },
        ],
      }],
    }],
    techKey: 'vivian',
    dateKey: '2026-06-26',
    offsetMinutes: 0,
    serviceLookups,
    productLookups,
    ticketMatchesTechReportDate: (ticket, targetDateKey) => ticket.dateKey === targetDateKey,
    getTechReportTicketDate: (ticket) => new Date(ticket.closedAt),
    normalizeTechnicianName: (value) => String(value || '').trim().toLowerCase(),
    isProductService: (service) => isTicketItemProduct(service, {
      serviceLookups,
      productLookups,
    }),
    getTechReportLineTotalForTech: (service) => Number(service.price) || 0,
    getTechReportLineDeductible: () => 0,
    ticketNotificationLabel: (ticket) => `#${ticket.ticketCode}`,
  });

  assert.equal(result.total, 13);
  assert.deepEqual(result.groups[0].services, [{
    name: 'ja',
    amount: 13,
    deductible: 0,
  }]);
});
