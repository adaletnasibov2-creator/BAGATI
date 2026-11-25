/**
 * PRICE-SYMBOL-1: the one money format customers and sellers see: "42.90 ₼" (2 decimals with a dot, a space, ₼).
 * Same text on the server and in every browser (no Intl/locale data). Display only: amounts are stored and calculated
 * unchanged, and "AZN" stays wherever it is a code (database, API fields, Epoint, JSON-LD priceCurrency, CSV, e-mails).
 * The admin panel keeps its own format (lib/format-money.ts: "1 234,50 AZN").
 * Accepts numbers, numeric strings and Prisma Decimal (anything with a numeric toString()).
 */
export const PRICE_SYMBOL = "₼";

/** "42.90", or null when the value is missing or not a number. A value that rounds to zero has no sign ("0.00"). */
export function priceAmount(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(number)) return null;
  const fixed = Math.abs(number).toFixed(2);
  return number < 0 && fixed !== "0.00" ? `-${fixed}` : fixed;
}

/** "42.90 ₼"; `fallback` (default "—") when the value is missing or not a number. */
export function formatPrice(value: unknown, fallback = "—"): string {
  const amount = priceAmount(value);
  return amount === null ? fallback : `${amount} ${PRICE_SYMBOL}`;
}

/** Same, from integer cents (the cart and the seller reports keep money in cents): 4290 -> "42.90 ₼". */
export function formatPriceCents(cents: number | null | undefined, fallback = "—"): string {
  return cents === null || cents === undefined || !Number.isFinite(cents) ? fallback : formatPrice(cents / 100, fallback);
}
