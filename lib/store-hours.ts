/**
 * STORE-HOURS: optional opening hours of a store, ONE time range for every day, shown as information only.
 * Pure: no database, no request. Never used by order, cart, checkout, payment or email code (scripts/store-hours.test.ts).
 *
 * Times are "HH:MM" (00:00–23:59), stored as text in Store."openingTime" / Store."closingTime" (both set or both NULL,
 * never equal; CHECK constraints in migration 20261122000000_store_business_hours). A closing time earlier than the
 * opening time is an overnight range (18:00–02:00). Open is inclusive, close is exclusive. "Now" is read in Asia/Baku
 * through Intl (no fixed +4 offset).
 */

export const STORE_HOURS_TIME_ZONE = "Asia/Baku";
export const STORE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Approved texts (owner, STORE-HOURS). */
export const STORE_HOURS_TEXTS = {
  sectionTitle: "İş saatları",
  openingLabel: "Açılış saatı",
  closingLabel: "Bağlanış saatı",
  help: "Bu, mağazanın iş saatlarıdır. Sifarişlər istənilən vaxt qəbul olunur.",
  inside: "İndi iş saatıdır",
  outside: "İndi iş saatı deyil",
} as const;

/** "09:30" -> 570 minutes after midnight; anything else -> null. */
export function parseStoreTime(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !STORE_TIME_PATTERN.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

export type StoreHours = { openingTime: string; closingTime: string };
export type StoreHoursInputResult =
  | { ok: true; value: { openingTime: string | null; closingTime: string | null } }
  | { ok: false; reason: "ONE_FIELD_ONLY" | "FORMAT" | "EQUAL_TIMES" };

/**
 * Server-side check of the seller form (never trust the browser). Empty, null and missing all mean "no value";
 * both empty = hours removed. One field only, a wrong format or equal times are refused.
 */
export function normalizeStoreHoursInput(input: { openingTime?: unknown; closingTime?: unknown }): StoreHoursInputResult {
  const clean = (value: unknown) => (typeof value === "string" ? value.trim() : value == null ? "" : null);
  const opening = clean(input.openingTime);
  const closing = clean(input.closingTime);
  if (opening === null || closing === null) return { ok: false, reason: "FORMAT" };
  if (!opening && !closing) return { ok: true, value: { openingTime: null, closingTime: null } };
  if (!opening || !closing) return { ok: false, reason: "ONE_FIELD_ONLY" };
  if (parseStoreTime(opening) === null || parseStoreTime(closing) === null) return { ok: false, reason: "FORMAT" };
  if (opening === closing) return { ok: false, reason: "EQUAL_TIMES" };
  return { ok: true, value: { openingTime: opening, closingTime: closing } };
}

/** The stored pair when it is complete and valid, else null (then nothing is shown anywhere). */
export function storeHoursOf(store: { openingTime?: string | null; closingTime?: string | null }): StoreHours | null {
  const result = normalizeStoreHoursInput({ openingTime: store.openingTime ?? "", closingTime: store.closingTime ?? "" });
  return result.ok && result.value.openingTime && result.value.closingTime
    ? { openingTime: result.value.openingTime, closingTime: result.value.closingTime }
    : null;
}

/** "İş saatları: 09:00–18:00" (en dash), or null without valid hours. */
export function storeHoursLine(store: { openingTime?: string | null; closingTime?: string | null }): string | null {
  const hours = storeHoursOf(store);
  return hours ? `${STORE_HOURS_TEXTS.sectionTitle}: ${hours.openingTime}–${hours.closingTime}` : null;
}

const bakuClock = new Intl.DateTimeFormat("en-GB", { timeZone: STORE_HOURS_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Minutes after midnight on the Baku wall clock for the given instant. */
export function bakuMinutesOfDay(now: Date): number {
  const parts = bakuClock.formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return (hour % 24) * 60 + minute;
}

/**
 * true = inside the hours now (Baku time), false = outside, null = no valid hours.
 * Normal range: open <= now < close. Overnight range (close < open): now >= open OR now < close.
 */
export function isWithinStoreHours(openingTime: string | null | undefined, closingTime: string | null | undefined, now: Date = new Date()): boolean | null {
  const hours = storeHoursOf({ openingTime, closingTime });
  if (!hours) return null;
  const open = parseStoreTime(hours.openingTime)!;
  const close = parseStoreTime(hours.closingTime)!;
  const current = bakuMinutesOfDay(now);
  return open < close ? current >= open && current < close : current >= open || current < close;
}
