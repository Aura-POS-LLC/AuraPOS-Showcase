export function normalizeLoyaltyRewardType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (type === 'percent_off' || type === 'amount_off' || type === 'fixed_service' || type === 'fixed_product') {
    return type;
  }
  return 'amount_off';
}

export function calculateLoyaltyRewardCredit({
  rewardType,
  rewardValue,
  baseAmount,
  maxPerRedemption = null,
} = {}) {
  const base = Math.max(0, Number(baseAmount) || 0);
  if (base <= 0) return 0;

  const type = normalizeLoyaltyRewardType(rewardType);
  const value = Math.max(0, Number(rewardValue) || 0);
  if (value <= 0) return 0;

  let rawDiscount = 0;
  if (type === 'percent_off') {
    rawDiscount = base * (value / 100);
  } else {
    rawDiscount = value;
  }

  const maxCap = maxPerRedemption === null || maxPerRedemption === undefined
    ? null
    : Math.max(0, Number(maxPerRedemption) || 0);
  let capped = Math.max(0, rawDiscount);
  if (maxCap !== null && maxCap > 0) {
    capped = Math.min(capped, maxCap);
  }
  capped = Math.min(capped, base);
  return Math.round(capped * 100) / 100;
}
