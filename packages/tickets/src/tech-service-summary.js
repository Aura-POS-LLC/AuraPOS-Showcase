export function buildTechServiceSummaryOptimized({
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

  const sourceTickets = Array.isArray(finishedTickets) ? finishedTickets : [];
  const matchedTickets = [];
  for (let i = 0; i < sourceTickets.length; i += 1) {
    const ticket = sourceTickets[i];
    if (!ticketMatchesTechReportDate(ticket, dateKey, offsetMinutes)) continue;
    const closedAt = getTechReportTicketDate(ticket);
    const closedAtTime = closedAt?.getTime();
    matchedTickets.push({
      ticket,
      closedAt,
      closedAtTime: Number.isFinite(closedAtTime) ? closedAtTime : 0,
    });
  }

  matchedTickets.sort((a, b) => a.closedAtTime - b.closedAtTime);

  for (let ticketIdx = 0; ticketIdx < matchedTickets.length; ticketIdx += 1) {
    const record = matchedTickets[ticketIdx];
    const ticket = record.ticket;
    const groupsForTicket = Array.isArray(ticket?.techs) ? ticket.techs : [];

    for (let groupIdx = 0; groupIdx < groupsForTicket.length; groupIdx += 1) {
      const group = groupsForTicket[groupIdx];
      const groupKey = normalizeTechnicianName(group?.tech || '');
      if (!groupKey || groupKey !== techKey) continue;

      const rawServices = Array.isArray(group?.services) ? group.services : [];
      if (!rawServices.length) continue;

      const serviceLines = [];
      let hasNonProductService = false;

      for (let svcIdx = 0; svcIdx < rawServices.length; svcIdx += 1) {
        const svc = rawServices[svcIdx];
        if (isProductService(svc, productLookups)) continue;
        hasNonProductService = true;

        const name = String(svc?.name || svc?.serviceName || 'Service').trim() || 'Service';
        const qty = Number.isFinite(svc?.qty) ? Math.max(1, svc.qty) : 1;
        const lineTotal = getTechReportLineTotalForTech(svc);
        const perUnitAmount = qty > 0 ? lineTotal / qty : lineTotal;
        const perUnitDeductible = getTechReportLineDeductible(svc, serviceLookups);

        for (let unitIdx = 0; unitIdx < qty; unitIdx += 1) {
          const deductible = Math.min(perUnitAmount, perUnitDeductible);
          serviceLines.push({
            name,
            amount: perUnitAmount,
            deductible,
          });
          total += perUnitAmount;
          deductibleTotal += Math.max(0, deductible);
        }
      }

      if (!hasNonProductService) continue;

      const tip = Number.isFinite(group?.tip) ? Math.max(0, group.tip) : 0;
      tipTotal += tip;

      const rawCustomer = ticket?.customer?.name || ticket?.customerName || '';
      const ticketLabel = ticketNotificationLabel(ticket);
      const customerName = String(rawCustomer).trim() || ticketLabel || 'Walk-in';

      groups.push({
        customerName,
        closedAt: record.closedAt ? record.closedAt.toISOString() : null,
        services: serviceLines,
        tip,
      });
    }
  }

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
