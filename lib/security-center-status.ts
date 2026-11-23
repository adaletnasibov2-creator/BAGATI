/**
 * SECURITY-CENTER-DESIGN-1: the overall verdict of /admin/security-center and the chart buckets. Pure (no database, no
 * request access) and unit-tested. Every input is real data already read by lib/security-center-data.ts; nothing is
 * estimated, and no edge or firewall data (not available to the app) is used.
 */
import { portalForPath } from "@/lib/security-center-view";
import { ADMIN_IDLE_TIMEOUT_MS } from "@/lib/session-policy";

export type StatusLevel = "ok" | "attention" | "problem";

/** The rule thresholds (also listed in the report). */
export const STATUS_THRESHOLDS = {
  /** Failed logins in the last 24 h: a spike needs at least this many ... */
  failedSpikeMin: 20,
  /** ... and at least this many times the previous 24 h (previous 0 counts as 1). */
  failedSpikeFactor: 3,
  /** Failed logins on ADMIN accounts (audited ADMIN_LOGIN_FAILED) in 24 h: attention from ... */
  adminFailedAttention: 3,
  /** ... problem from. */
  adminFailedProblem: 10,
} as const;

/**
 * NEW visible texts (proposed; final only after the owner approves them). Everything else on the page is existing
 * wording from SECURITY-PAGE-1.
 */
export const STATUS_TEXT = {
  ok: "Diqqət tələb edən heç nə tapılmadı",
  attention: "Diqqət tələb edir",
  problem: "Problem var",
  checked: "Yoxlanılan: adminlərin 2FA-sı, 2FA kilidləri, uğursuz girişlər, admin hesablarına cəhdlər, IP-nin tanınması və açıq insidentlər.",
  noTwoFactor: (n: number) => `${n} aktiv admin hesabında iki mərhələli təsdiq qoşulmayıb.`,
  locked: (n: number) => `${n} admin hesabının 2FA girişi müvəqqəti kilidlənib.`,
  ip: (title: string) => `IP yoxlaması: ${title}.`,
  spike: (now: number, before: number) => `Son 24 saatda uğursuz girişlər artıb: ${now} (əvvəlki 24 saatda ${before}).`,
  adminFailed: (n: number) => `Son 24 saatda admin hesablarına ${n} uğursuz giriş cəhdi olub.`,
  highIncidents: (n: number) => `${n} açıq yüksək riskli insident var.`,
  incidents: (n: number) => `${n} açıq insident var.`,
  unavailable: "Bəzi məlumatlar yüklənmədi; vəziyyət tam yoxlanmayıb.",
} as const;

/** NEW visible texts of the dashboard cards, chart and links (proposed, like STATUS_TEXT). */
export const DASHBOARD_TEXT = {
  twoFactorTitle: "Adminlərin 2FA-sı",
  twoFactorHint: "aktiv admin hesabında qoşulub",
  failed24hTitle: "Uğursuz girişlər · son 24 saat",
  previous24h: (n: number) => `Əvvəlki 24 saat: ${n}`,
  failed7dTitle: "Uğursuz girişlər · son 7 gün",
  failed7dHint: "Bütün giriş səhifələri üzrə",
  sessionsTitle: "Aktiv admin sessiyaları",
  sessionsHint: "Son 2 saatda istifadə olunub",
  lastLoginTitle: "Son admin girişi",
  failedCount: (n: number) => `${n} uğursuz giriş`,
  showMore: (n: number) => `Daha çox göstər (${n})`,
  relatedPages: "Əlaqəli səhifələr",
  noFailed24h: "Son 24 saatda uğursuz giriş yoxdur.",
} as const;

export type StatusReason = { level: Exclude<StatusLevel, "ok">; code: string; text: string };

export type StatusInput = {
  admins: ReadonlyArray<{ isActive: boolean; twoFactorOn: boolean; lockedUntil: Date | null }> | null;
  failed: { last24h: number; prev24h: number } | null;
  adminFailed24h: number | null;
  ip: { tone: "good" | "warn" | "bad"; title: string };
  incidents: ReadonlyArray<{ severity: string }> | null;
};

/**
 * Rules (problem beats attention):
 * - problem: IP check "bad" (trust flag on, but no trusted client IP); an open HIGH/CRITICAL incident;
 *   ≥ adminFailedProblem failed logins on admin accounts in 24 h.
 * - attention: an ACTIVE admin without 2FA; an admin whose 2FA login is locked now; IP check "warn";
 *   a failed-login spike (≥ failedSpikeMin in 24 h and ≥ failedSpikeFactor × the previous 24 h);
 *   ≥ adminFailedAttention (and < adminFailedProblem) failed logins on admin accounts in 24 h;
 *   an open incident of lower severity; any data block that could not be read.
 * - ok: none of the above.
 */
export function securityVerdict(input: StatusInput, now: Date): { level: StatusLevel; reasons: StatusReason[] } {
  const reasons: StatusReason[] = [];
  const add = (level: StatusReason["level"], code: string, text: string) => reasons.push({ level, code, text });

  if (input.ip.tone === "bad") add("problem", "ip-bad", STATUS_TEXT.ip(input.ip.title));
  if (input.incidents) {
    const high = input.incidents.filter((row) => row.severity === "HIGH" || row.severity === "CRITICAL").length;
    const other = input.incidents.length - high;
    if (high > 0) add("problem", "incident-high", STATUS_TEXT.highIncidents(high));
    if (other > 0) add("attention", "incident", STATUS_TEXT.incidents(other));
  }
  if (input.adminFailed24h !== null) {
    if (input.adminFailed24h >= STATUS_THRESHOLDS.adminFailedProblem) add("problem", "admin-failed", STATUS_TEXT.adminFailed(input.adminFailed24h));
    else if (input.adminFailed24h >= STATUS_THRESHOLDS.adminFailedAttention) add("attention", "admin-failed", STATUS_TEXT.adminFailed(input.adminFailed24h));
  }
  if (input.admins) {
    const withoutTwoFactor = input.admins.filter((row) => row.isActive && !row.twoFactorOn).length;
    const locked = input.admins.filter((row) => row.lockedUntil && row.lockedUntil.getTime() > now.getTime()).length;
    if (withoutTwoFactor > 0) add("attention", "no-2fa", STATUS_TEXT.noTwoFactor(withoutTwoFactor));
    if (locked > 0) add("attention", "locked", STATUS_TEXT.locked(locked));
  }
  if (input.ip.tone === "warn") add("attention", "ip-warn", STATUS_TEXT.ip(input.ip.title));
  if (input.failed && isFailedLoginSpike(input.failed.last24h, input.failed.prev24h)) add("attention", "spike", STATUS_TEXT.spike(input.failed.last24h, input.failed.prev24h));
  if (!input.admins || !input.failed || input.adminFailed24h === null || !input.incidents) add("attention", "unavailable", STATUS_TEXT.unavailable);

  const level: StatusLevel = reasons.some((reason) => reason.level === "problem") ? "problem" : reasons.length ? "attention" : "ok";
  // Problems first, then attention, in rule order.
  return { level, reasons: [...reasons.filter((r) => r.level === "problem"), ...reasons.filter((r) => r.level === "attention")] };
}

export function isFailedLoginSpike(last24h: number, prev24h: number): boolean {
  return last24h >= STATUS_THRESHOLDS.failedSpikeMin && last24h >= STATUS_THRESHOLDS.failedSpikeFactor * Math.max(1, prev24h);
}

/** Same rule as the session itself (lib/session-policy.ts): not revoked, not expired, used within the admin idle timeout. */
export function isAdminSessionActive(session: { revokedAt: Date | null; expiresAt: Date; lastSeenAt: Date | null; createdAt: Date }, now: Date): boolean {
  if (session.revokedAt || session.expiresAt.getTime() <= now.getTime()) return false;
  return now.getTime() - (session.lastSeenAt ?? session.createdAt).getTime() <= ADMIN_IDLE_TIMEOUT_MS;
}

// ------------------------------------------------------------------ chart buckets (Asia/Baku: UTC+4, no DST)

const BAKU_OFFSET_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** YYYY-MM-DD of the Baku calendar day of `date`. */
export function bakuDayKey(date: Date): string {
  return new Date(date.getTime() + BAKU_OFFSET_MS).toISOString().slice(0, 10);
}

/** The last `days` Baku days, oldest first, ending with today. */
export function lastBakuDays(now: Date, days: number): string[] {
  return Array.from({ length: days }, (_, index) => bakuDayKey(new Date(now.getTime() - (days - 1 - index) * DAY_MS)));
}

/** Start of the Baku day `days - 1` days ago (the lower bound of the 7-day chart), as a UTC instant. */
export function bakuDaysStart(now: Date, days: number): Date {
  const firstKey = lastBakuDays(now, days)[0];
  return new Date(Date.parse(`${firstKey}T00:00:00.000Z`) - BAKU_OFFSET_MS);
}

export type DayRow = { day: string; path: string | null; count: number };
export type DayBucket = { day: string; total: number; byType: Record<string, number> };

/**
 * Daily failed logins, split by login type (the existing portal labels). Every day of `days` appears, zero days
 * included; rows outside the window are ignored.
 */
export function dailyFailedLogins(rows: readonly DayRow[], days: readonly string[]): { buckets: DayBucket[]; types: string[] } {
  const buckets = new Map(days.map((day) => [day, { day, total: 0, byType: {} as Record<string, number> }]));
  const typeTotals = new Map<string, number>();
  for (const row of rows) {
    const bucket = buckets.get(row.day);
    if (!bucket) continue;
    const type = portalForPath(row.path);
    bucket.total += row.count;
    bucket.byType[type] = (bucket.byType[type] ?? 0) + row.count;
    typeTotals.set(type, (typeTotals.get(type) ?? 0) + row.count);
  }
  const types = [...typeTotals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([type]) => type);
  return { buckets: [...buckets.values()], types };
}

/**
 * Hourly failed logins for the last 24 hours. `rows` carry UTC hour keys "YYYY-MM-DDTHH" (from the database's UTC
 * wall-clock column); the result is labelled in Baku time ("HH:00"), every hour present, oldest first.
 */
export function hourlyFailedLogins(rows: ReadonlyArray<{ hour: string; count: number }>, now: Date): Array<{ key: string; label: string; count: number }> {
  const counts = new Map(rows.map((row) => [row.hour, row.count]));
  const currentHour = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  return Array.from({ length: 24 }, (_, index) => {
    const start = new Date(currentHour - (23 - index) * HOUR_MS);
    const utcKey = start.toISOString().slice(0, 13);
    const baku = new Date(start.getTime() + BAKU_OFFSET_MS).toISOString();
    return { key: utcKey, label: `${baku.slice(11, 13)}:00`, count: counts.get(utcKey) ?? 0 };
  });
}

/** Short device text for a stored session user agent (already short, e.g. "Chrome 140 · Windows"). */
export function deviceText(userAgent: string | null | undefined): string {
  const value = (userAgent ?? "").trim();
  return value ? value.slice(0, 60) : "—";
}
