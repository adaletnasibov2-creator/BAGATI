/**
 * Store delivery in integer cents, for the browser (CART-DELIVERY). Same rules as calculateStoreDelivery in
 * lib/delivery.ts, which uses Prisma.Decimal and therefore cannot run on the client:
 *   - free when the store subtotal >= the store's free-delivery threshold (inclusive);
 *   - no threshold set -> 30.00 (DEFAULT_FREE_DELIVERY_THRESHOLD); no fee set -> 0.00 (TEMPORARY_DEFAULT_DELIVERY_FEE).
 * scripts/cart-delivery.test.ts compares this helper with calculateStoreDelivery on many cases (parity test).
 * Pure: no Prisma, no floating-point money arithmetic (amounts are parsed into whole cents).
 */
export const DEFAULT_FREE_DELIVERY_THRESHOLD_CENTS = 3000;
export const DEFAULT_DELIVERY_FEE_CENTS = 0;

/**
 * "12.5", "12.50", 12.5, "0" -> 1250 / 1250 / 1250 / 0. Amounts are stored as Decimal(12,2), so they have at most
 * two decimals; anything else (empty, negative, 3+ decimals, not a number) returns null.
 */
export function toCents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "number" ? (Number.isFinite(value) ? value.toFixed(2) : "") : value.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** "AZN"-free 2-decimal text for cents: 1250 -> "12.50". */
export function centsToFixed(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export type StoreDeliveryCents = { subtotalCents: number; deliveryFeeCents: number; freeDelivery: boolean; freeDeliveryThresholdCents: number; storeTotalCents: number };

export function storeDeliveryCents(subtotalCents: number, config: { freeDeliveryThreshold?: string | number | null; deliveryFee?: string | number | null } = {}): StoreDeliveryCents {
  const freeDeliveryThresholdCents = config.freeDeliveryThreshold == null ? DEFAULT_FREE_DELIVERY_THRESHOLD_CENTS : toCents(config.freeDeliveryThreshold) ?? DEFAULT_FREE_DELIVERY_THRESHOLD_CENTS;
  const configuredFeeCents = config.deliveryFee == null ? DEFAULT_DELIVERY_FEE_CENTS : toCents(config.deliveryFee) ?? DEFAULT_DELIVERY_FEE_CENTS;
  const freeDelivery = subtotalCents >= freeDeliveryThresholdCents;
  const deliveryFeeCents = freeDelivery ? 0 : configuredFeeCents;
  return { subtotalCents, deliveryFeeCents, freeDelivery, freeDeliveryThresholdCents, storeTotalCents: subtotalCents + deliveryFeeCents };
}

/** Line total in cents: unit price (2-decimal string from /api/cart) × quantity. Invalid prices count as 0, as before. */
export function lineTotalCents(unitPrice: string | number, quantity: number): number {
  const cents = toCents(unitPrice);
  return cents === null || !Number.isInteger(quantity) || quantity < 0 ? 0 : cents * quantity;
}

/**
 * CART-POLISH: how much more the store's items must cost before its own free-delivery threshold is reached, in
 * cents, from the same StoreDeliveryCents the totals use (threshold minus store subtotal). null when nothing should be
 * shown: delivery is already free, the store's fee is 0 (nothing to save), or the amount would be 0 or less.
 */
export function remainingForFreeDeliveryCents(delivery: StoreDeliveryCents): number | null {
  if (delivery.freeDelivery || delivery.deliveryFeeCents <= 0) return null;
  const remaining = delivery.freeDeliveryThresholdCents - delivery.subtotalCents;
  return remaining > 0 ? remaining : null;
}
