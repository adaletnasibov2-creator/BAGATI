export function getProductDiscount(
  currentPrice: string | number,
  originalPrice: string | number | null | undefined,
): { discounted: boolean; percentOff: number | null } {
  const current = Number(currentPrice);
  const original = Number(originalPrice);
  const discounted =
    Number.isFinite(current) &&
    Number.isFinite(original) &&
    current > 0 &&
    original > current;

  if (!discounted) return { discounted: false, percentOff: null };

  const percentOff = Math.round(((original - current) / original) * 100);
  return { discounted: true, percentOff: percentOff > 0 ? percentOff : null };
}
