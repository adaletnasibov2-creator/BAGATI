/**
 * STORE-HOURS-3: pure helpers for the seller's 24-hour picker (one hour select + one minute select per field).
 * The stored value stays "HH:MM" (24-hour); validation of the pair stays in lib/store-hours.ts and the API.
 */

const PART = /^\d{2}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "00" … "23". */
export const STORE_HOUR_OPTIONS: readonly string[] = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));

/** "00", "05" … "55". */
export const STORE_MINUTE_STEP_OPTIONS: readonly string[] = Array.from({ length: 12 }, (_, step) => String(step * 5).padStart(2, "0"));

/** Splits a saved "HH:MM" into its hour and minute; anything else (empty, null, malformed) is "not set". */
export function splitStoreTime(value: string | null | undefined): { hour: string; minute: string } {
  const match = typeof value === "string" ? TIME.exec(value.trim()) : null;
  return match ? { hour: match[1], minute: match[2] } : { hour: "", minute: "" };
}

/** "HH:MM" only when BOTH parts are chosen and valid; otherwise "" (never a half value). */
export function joinStoreTime(hour: string, minute: string): string {
  if (!PART.test(hour) || !PART.test(minute)) return "";
  const value = `${hour}:${minute}`;
  return TIME.test(value) ? value : "";
}

/**
 * The minute list for one field: the 5-minute steps, plus the saved minute when it is not a step
 * (e.g. 09:07 keeps "07"), so editing never loses a saved value.
 */
export function storeMinuteOptions(savedValue: string | null | undefined): string[] {
  const { minute } = splitStoreTime(savedValue);
  if (!minute || STORE_MINUTE_STEP_OPTIONS.includes(minute)) return [...STORE_MINUTE_STEP_OPTIONS];
  return [...STORE_MINUTE_STEP_OPTIONS, minute].sort();
}
