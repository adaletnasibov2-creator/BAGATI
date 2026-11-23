/**
 * SECURITY-CENTER-DESIGN-1: the overall verdict of /admin/security-center and the chart buckets. Pure (no database, no
 * request access) and unit-tested. Every input is real data already read by lib/security-center-data.ts; nothing is
 * estimated, and no edge or firewall data (not available to the app) is used.
 */
import { portalForPath } from "@/lib/security-center-view";
import { getAlertRule } from "@/lib/security-monitoring/rules";
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
  // SECURITY-CENTER-DESIGN-2: the rule names are added, so the banner says WHAT is open (no names: the DESIGN-1 text).
  highIncidents: (n: number, rules: readonly string[] = []) => rules.length ? `${n} açıq yüksək riskli insident var: ${rules.join(", ")}.` : `${n} açıq yüksək riskli insident var.`,
  incidents: (n: number, rules: readonly string[] = []) => rules.length ? `${n} açıq insident var: ${rules.join(", ")}.` : `${n} açıq insident var.`,
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

/**
 * SECURITY-CENTER-DESIGN-2: every reason says where to go and what to do there (`href` + `action`, the link text).
 * A reason without a page to open (data unavailable) has no href; the refresh button is the next step.
 */
export type StatusReason = { level: Exclude<StatusLevel, "ok">; code: string; text: string; href?: string; action?: string };

/** One open incident group. `count` defaults to 1 (DESIGN-1 passed one row per incident). */
export type IncidentCount = { severity: string; ruleKey?: string; count?: number };

export type StatusInput = {
  admins: ReadonlyArray<{ isActive: boolean; twoFactorOn: boolean; lockedUntil: Date | null }> | null;
  failed: { last24h: number; prev24h: number } | null;
  adminFailed24h: number | null;
  ip: { tone: "good" | "warn" | "bad"; title: string };
  incidents: ReadonlyArray<IncidentCount> | null;
};

// ------------------------------------------------------------------ SECURITY-CENTER-DESIGN-2

/**
 * Background internet scanning: incidents of these rules are NOT problems (bots probe .php / wp-admin / env files on
 * every public site). They are left out of the verdict and shown on the calm scan card instead. Detection itself is
 * unchanged (the rule still opens incidents; changing it is a proposal in the report).
 */
export const SCAN_NOISE_RULE_KEYS: readonly string[] = ["not_found_scan"];
export const isScanNoise = (ruleKey: string | null | undefined) => Boolean(ruleKey && SCAN_NOISE_RULE_KEYS.includes(ruleKey));
export const isHighSeverity = (severity: string) => severity === "HIGH" || severity === "CRITICAL";
const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/** The rule's Azerbaijani name (existing label from lib/security-monitoring/rules.ts); unknown keys stay as they are. */
export const ruleName = (ruleKey: string) => getAlertRule(ruleKey)?.label ?? ruleKey;

/** The tabs of the security center (existing page titles where one exists). */
export const SECURITY_TABS = [
  { id: "overview", href: "/admin/security-center", label: "Ümumi baxış" },
  { id: "incidents", href: "/admin/security-center/incidents", label: "İnsidentlər" },
  { id: "logins", href: "/admin/security-center/logins", label: "Girişlər" },
  { id: "events", href: "/admin/security-center/events", label: "Hadisələr" },
  { id: "audit", href: "/admin/security-center/audit", label: "Audit" },
] as const;
export type SecurityTab = (typeof SECURITY_TABS)[number]["id"];

/** NEW visible texts of DESIGN-2 (proposed; final only after the owner approves them). */
export const CENTER_TEXT = {
  subtitle: "Bazada qeydə alınmış real məlumat.",
  // Banner: link texts for the reasons that have no existing page title.
  seeBelow: "Aşağıda bax",
  seeLogins: "Girişlərə bax",
  retry: "Yeniləyin; təkrarlanarsa, sistem vəziyyətinə baxın.",
  // "Needs attention" list.
  attentionTitle: "Diqqət tələb edənlər",
  attentionNote: "Ən vacib 5 açıq insident. Fon skanı burada sayılmır.",
  observed: (observed: number, threshold: number, windowMinutes: number) => `Ölçülən dəyər: ${observed} (hədd ${threshold}, ${windowMinutes} dəq)`,
  seeAll: (n: number) => `Hamısına bax (${n})`,
  details: "Ətraflı",
  // Scan card.
  scanTitle: "Fon internet skanı",
  scanBadge: "Problem sayılmır",
  scanText: "Botlar hər açıq saytda mövcud olmayan səhifələri (.php, wp-admin, mühit faylları) yoxlayır. Bu səhifələr saytda yoxdur və 404 cavabı alır. Bu, hər saytda normaldır.",
  scan24h: (n: number) => `Son 24 saat: ${n}`,
  scan7d: (n: number) => `Son 7 gün: ${n}`,
  scanChart: "404 sorğuları · son 7 gün",
  scanNone: "Son 7 gündə 404 sorğusu yoxdur.",
  scanOpen: (n: number) => `${n} skan insidenti açıq qalıb. Onlar heç bir addım tələb etmir.`,
  bulkClose: (n: number) => `Skan insidentlərini həll et (${n})`,
  bulkConfirm: (n: number) => `${n} skan insidenti "Həll edildi" ediləcək. Hər biri audit jurnalına yazılır.`,
  bulkYes: "Bəli, həll et",
  bulkCancel: "Ləğv et",
  bulkBusy: (done: number, total: number) => `Həll edilir… ${done} / ${total}`,
  bulkDone: (ok: number, failed: number) => failed ? `${ok} insident həll edildi, ${failed} alınmadı.` : `${ok} insident həll edildi.`,
  // Incident actions.
  statusChanged: (status: string) => `İnsidentin statusu dəyişdi: ${status}.`,
  // Refresh.
  lastRefresh: (clock: string) => `Son yenilənmə: ${clock}`,
  refreshing: "Yenilənir…",
  refreshed: "Məlumatlar yeniləndi.",
  refreshFailed: "Yenilənmədi. Bir az sonra yenidən cəhd edin.",
  autoRefresh: "Avtomatik yenilə (60 san)",
  autoStopped: "Avtomatik yeniləmə bir saatdan sonra dayandırıldı.",
  // Logins tab: link to the existing sessions page.
  allSessions: "Bütün sessiyalar →",
} as const;

/**
 * One line per rule: what it means in plain words and what to do (NEW texts). Every rule of SECURITY_ALERT_RULES has
 * one (unit-tested); `href` is the page where the next step is done.
 */
export const INCIDENT_HELP: Readonly<Record<string, { text: string; href: string }>> = {
  login_failure_burst: { text: "Qısa müddətdə çox uğursuz giriş olub. Girişlərə baxın; cəhdlər dayanıbsa, həll edin.", href: "/admin/security-center/logins" },
  auth_denied_spike: { text: "İcazəsiz sorğular artıb, adətən botlardır. Təkrarlanmırsa, həll edin.", href: "/admin/security-center/events" },
  not_found_scan: { text: "Mövcud olmayan səhifələrə avtomatik sorğular (fon skanı). Addım tələb etmir.", href: "/admin/security-center/events" },
  server_error_spike: { text: "Server xətaları artıb. Sistem vəziyyətinə baxın; düzəlibsə, həll edin.", href: "/admin/system" },
  rate_limit_spike: { text: "Çox sorğu limitə düşüb. Təkrarlanmırsa, həll edin.", href: "/admin/security-center/events" },
  ip_header_mismatch: { text: "Proxy-dən gələn IP başlıqları fərqlidir. Sistem vəziyyətində saxtalaşdırma testini işlədin; nəticə düzgündürsə, həll edin.", href: "/admin/system" },
  two_factor_failures: { text: "Admin 2FA kodu dəfələrlə səhv yazılıb. Bu siz deyilsinizsə, şifrəni dəyişin və sessiyalara baxın.", href: "/admin/security/sessions" },
  admin_login_failure_burst: { text: "Admin girişində çox uğursuz cəhd olub. Bu siz deyilsinizsə, şifrəni dəyişin və sessiyalara baxın.", href: "/admin/security/sessions" },
};

export type OpenIncident = { id: string; ruleKey: string; title: string; severity: string; status: string; observedValue: number; threshold: number; windowMinutes: number; createdAt: Date };

/** The "needs attention" list: open incidents that are not scan noise, highest severity first, then newest; at most 5. */
export function attentionIncidents<T extends Pick<OpenIncident, "ruleKey" | "severity" | "createdAt">>(rows: readonly T[], limit = 5): T[] {
  return rows.filter((row) => !isScanNoise(row.ruleKey))
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}

/** Open incidents counted by kind; scan noise is counted apart, never as high or other. */
export function incidentTotals(rows: ReadonlyArray<IncidentCount>): { high: number; other: number; scan: number } {
  let high = 0, other = 0, scan = 0;
  for (const row of rows) {
    const n = row.count ?? 1;
    if (isScanNoise(row.ruleKey)) scan += n;
    else if (isHighSeverity(row.severity)) high += n;
    else other += n;
  }
  return { high, other, scan };
}

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
  const add = (level: StatusReason["level"], code: string, text: string, href?: string, action?: string) =>
    reasons.push({ level, code, text, ...(href ? { href } : {}), ...(action ? { action } : {}) });
  // Existing page titles are the link texts where such a page exists.
  const SYSTEM = ["/admin/system", "Sistem vəziyyəti"] as const;
  const ACCOUNT = ["/admin/security", "Hesab təhlükəsizliyi"] as const;
  const LOGINS = ["/admin/security-center/logins", CENTER_TEXT.seeLogins] as const;
  const BELOW = ["#needs-attention", CENTER_TEXT.seeBelow] as const;

  if (input.ip.tone === "bad") add("problem", "ip-bad", STATUS_TEXT.ip(input.ip.title), ...SYSTEM);
  if (input.incidents) {
    // DESIGN-2: background scanning (SCAN_NOISE_RULE_KEYS) is not a problem and is not counted here.
    const counted = input.incidents.filter((row) => !isScanNoise(row.ruleKey));
    const names = (rows: typeof counted) => [...new Set(rows.flatMap((row) => row.ruleKey ? [ruleName(row.ruleKey)] : []))];
    const sum = (rows: typeof counted) => rows.reduce((total, row) => total + (row.count ?? 1), 0);
    const highRows = counted.filter((row) => isHighSeverity(row.severity));
    const otherRows = counted.filter((row) => !isHighSeverity(row.severity));
    if (sum(highRows) > 0) add("problem", "incident-high", STATUS_TEXT.highIncidents(sum(highRows), names(highRows)), ...BELOW);
    if (sum(otherRows) > 0) add("attention", "incident", STATUS_TEXT.incidents(sum(otherRows), names(otherRows)), ...BELOW);
  }
  if (input.adminFailed24h !== null) {
    if (input.adminFailed24h >= STATUS_THRESHOLDS.adminFailedProblem) add("problem", "admin-failed", STATUS_TEXT.adminFailed(input.adminFailed24h), ...LOGINS);
    else if (input.adminFailed24h >= STATUS_THRESHOLDS.adminFailedAttention) add("attention", "admin-failed", STATUS_TEXT.adminFailed(input.adminFailed24h), ...LOGINS);
  }
  if (input.admins) {
    const withoutTwoFactor = input.admins.filter((row) => row.isActive && !row.twoFactorOn).length;
    const locked = input.admins.filter((row) => row.lockedUntil && row.lockedUntil.getTime() > now.getTime()).length;
    if (withoutTwoFactor > 0) add("attention", "no-2fa", STATUS_TEXT.noTwoFactor(withoutTwoFactor), ...ACCOUNT);
    if (locked > 0) add("attention", "locked", STATUS_TEXT.locked(locked), ...ACCOUNT);
  }
  if (input.ip.tone === "warn") add("attention", "ip-warn", STATUS_TEXT.ip(input.ip.title), ...SYSTEM);
  if (input.failed && isFailedLoginSpike(input.failed.last24h, input.failed.prev24h)) add("attention", "spike", STATUS_TEXT.spike(input.failed.last24h, input.failed.prev24h), ...LOGINS);
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

// ------------------------------------------------------------------ refresh (SECURITY-CENTER-DESIGN-2)

/** The optional auto-refresh: OFF by default, every 60 s, only while the tab is visible, at most 60 runs (1 hour). */
export const AUTO_REFRESH = { seconds: 60, maxRuns: 60 } as const;

/**
 * What the auto-refresh timer does on a tick: "stop" after maxRuns, "wait" while the tab is hidden or a refresh is
 * still running (nothing is sent), otherwise "refresh". A failed refresh turns it off too (refreshOutcome).
 */
export function autoRefreshStep(state: { visible: boolean; pending: boolean; runs: number }): "refresh" | "wait" | "stop" {
  if (state.runs >= AUTO_REFRESH.maxRuns) return "stop";
  if (!state.visible || state.pending) return "wait";
  return "refresh";
}

/** A refresh worked when the server rendered the page again: the render time it sends changed. */
export function refreshOutcome(before: string, after: string): "ok" | "failed" {
  return after !== before ? "ok" : "failed";
}

/** "HH:MM:SS" in Asia/Baku (UTC+4, no DST) for an ISO time; identical on the server and in the browser (no Intl). */
export function bakuClock(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? "—" : new Date(time + BAKU_OFFSET_MS).toISOString().slice(11, 19);
}

/** Short device text for a stored session user agent (already short, e.g. "Chrome 140 · Windows"). */
export function deviceText(userAgent: string | null | undefined): string {
  const value = (userAgent ?? "").trim();
  return value ? value.slice(0, 60) : "—";
}
