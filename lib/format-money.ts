/**
 * Money for the ADMIN panel: "1 234,50 AZN" (no-break space between thousands, comma decimals, always 2 decimals,
 * no-break space before AZN). Display only; amounts are stored and calculated unchanged.
 * Accepts numbers, numeric strings and Prisma Decimal (anything with a numeric toString()).
 */
const NBSP = " ";

export function formatAmount(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(number)) return null;
  const fixed = Math.abs(number).toFixed(2);
  const [whole, fraction] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  // "-0,00" is never shown: a value that rounds to zero has no sign.
  const sign = number < 0 && fixed !== "0.00" ? "-" : "";
  return `${sign}${grouped},${fraction}`;
}

/** "12,50 AZN"; `fallback` (default "—") when the value is missing or not a number. */
export function formatMoney(value: unknown, fallback = "—"): string {
  const amount = formatAmount(value);
  return amount === null ? fallback : `${amount}${NBSP}AZN`;
}

/** Same, from integer cents (reports keep money in cents). */
export function formatMoneyCents(cents: number | null | undefined, fallback = "—"): string {
  return cents === null || cents === undefined || !Number.isFinite(cents) ? fallback : formatMoney(cents / 100, fallback);
}
