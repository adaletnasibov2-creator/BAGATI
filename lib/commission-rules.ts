export type CommissionInterval = {
  startsAt: Date;
  endsAt: Date | null;
};

export function commissionIntervalsOverlap(left: CommissionInterval, right: CommissionInterval) {
  return (!left.endsAt || right.startsAt < left.endsAt) &&
    (!right.endsAt || left.startsAt < right.endsAt);
}

export function hasCommissionRuleConflict(
  candidate: CommissionInterval,
  existing: readonly CommissionInterval[],
) {
  return existing.some((rule) => commissionIntervalsOverlap(candidate, rule));
}

/**
 * Admin percent input → stored commission rate (Decimal(5,4) as a string): "10" → "0.1000", "12.5" → "0.1250".
 * Accepts a number or a string (comma or dot), at most two decimals, 0..maxPercent. Integer arithmetic only.
 */
export function commissionPercentToRate(input: unknown, maxPercent = 100): string | null {
  if (typeof input !== "string" && typeof input !== "number") return null;
  if (typeof input === "number" && !Number.isFinite(input)) return null;
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(String(input).trim());
  if (!match) return null;
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (basisPoints > maxPercent * 100) return null;
  const whole = Math.floor(basisPoints / 10000);
  return `${whole}.${String(basisPoints % 10000).padStart(4, "0")}`;
}

/** Stored rate → percent text for the form: "0.1000" → "10", "0.1250" → "12.5", "1.0000" → "100". */
export function commissionRateToPercent(rate: string | number | { toString(): string }): string {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(String(rate).trim());
  if (!match) return "";
  const basisPoints = Number(match[1]) * 10000 + Number((match[2] ?? "").padEnd(4, "0"));
  const whole = Math.floor(basisPoints / 100);
  const fraction = String(basisPoints % 100).padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/**
 * Rate of a commission rule from the admin API body. The form sends `ratePercent` (0–100, e.g. 10 for 10%);
 * the older `rate` (0–1) is still accepted so existing clients keep working. Sending both is refused.
 * `rate: undefined` means neither was sent (allowed for updates).
 */
export function commissionRateInput(body: unknown): { ok: true; rate: string | number | undefined } | { ok: false } {
  const value = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const hasPercent = value.ratePercent !== undefined && value.ratePercent !== null && value.ratePercent !== "";
  const hasRate = value.rate !== undefined && value.rate !== null && value.rate !== "";
  if (hasPercent && hasRate) return { ok: false };
  if (hasPercent) {
    const rate = commissionPercentToRate(value.ratePercent);
    return rate === null ? { ok: false } : { ok: true, rate };
  }
  if (hasRate) {
    const rate = Number(value.rate);
    return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? { ok: true, rate } : { ok: false };
  }
  return { ok: true, rate: undefined };
}
