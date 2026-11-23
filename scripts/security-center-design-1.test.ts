/**
 * SECURITY-CENTER-DESIGN-1: the /admin/security-center dashboard. Unit tests only: the pure verdict rules and chart
 * buckets, plus source checks of the bounded queries, IP masking, admin-only access and texts.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import {
  bakuDayKey, bakuDaysStart, dailyFailedLogins, DASHBOARD_TEXT, deviceText, hourlyFailedLogins, isAdminSessionActive, isFailedLoginSpike,
  lastBakuDays, securityVerdict, STATUS_TEXT, STATUS_THRESHOLDS, type StatusInput,
} from "../lib/security-center-status";
import { ADMIN_IDLE_TIMEOUT_MS } from "../lib/session-policy";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const BASE = "9d890b3"; // main before SECURITY-CENTER-DESIGN-1
const now = new Date("2026-11-23T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

const allOk = (): StatusInput => ({
  admins: [{ isActive: true, twoFactorOn: true, lockedUntil: null }, { isActive: true, twoFactorOn: true, lockedUntil: new Date(now.getTime() - HOUR) }],
  failed: { last24h: 4, prev24h: 3 },
  adminFailed24h: 0,
  ip: { tone: "good", title: "IP düzgün tanınır" },
  incidents: [],
});

// ================================================================= verdict rules

test("verdict: all clear -> ok, no reasons (the page then lists what was checked)", () => {
  assert.deepEqual(securityVerdict(allOk(), now), { level: "ok", reasons: [] });
  assert.deepEqual(securityVerdict({ ...allOk(), admins: [] }, now), { level: "ok", reasons: [] }, "no admins: nothing to flag");
  assert.deepEqual(securityVerdict({ ...allOk(), failed: { last24h: 0, prev24h: 0 } }, now).level, "ok", "empty data is calm");
});

test("verdict: attention rules, one by one", () => {
  const cases: Array<[string, Partial<StatusInput>, string]> = [
    ["active admin without 2FA", { admins: [{ isActive: true, twoFactorOn: false, lockedUntil: null }] }, STATUS_TEXT.noTwoFactor(1)],
    ["2FA lock in force", { admins: [{ isActive: true, twoFactorOn: true, lockedUntil: new Date(now.getTime() + HOUR) }] }, STATUS_TEXT.locked(1)],
    ["IP warn", { ip: { tone: "warn", title: "IP tanınmır" } }, STATUS_TEXT.ip("IP tanınmır")],
    ["failed-login spike", { failed: { last24h: 30, prev24h: 5 } }, STATUS_TEXT.spike(30, 5)],
    ["admin-account attempts (attention band)", { adminFailed24h: 3 }, STATUS_TEXT.adminFailed(3)],
    ["open low/medium incident", { incidents: [{ severity: "MEDIUM" }] }, STATUS_TEXT.incidents(1)],
    ["a data block could not be read", { incidents: null }, STATUS_TEXT.unavailable],
  ];
  for (const [label, change, text] of cases) {
    const verdict = securityVerdict({ ...allOk(), ...change }, now);
    assert.equal(verdict.level, "attention", label);
    assert.deepEqual(verdict.reasons.map((r) => r.text), [text], label);
  }
});

test("verdict: problem rules beat attention, problems listed first", () => {
  for (const [label, change, text] of [
    ["IP bad", { ip: { tone: "bad" as const, title: "IP tanınmır" } }, STATUS_TEXT.ip("IP tanınmır")],
    ["open HIGH incident", { incidents: [{ severity: "HIGH" }] }, STATUS_TEXT.highIncidents(1)],
    ["open CRITICAL incident", { incidents: [{ severity: "CRITICAL" }] }, STATUS_TEXT.highIncidents(1)],
    ["10 admin-account attempts", { adminFailed24h: 10 }, STATUS_TEXT.adminFailed(10)],
  ] as Array<[string, Partial<StatusInput>, string]>) {
    const verdict = securityVerdict({ ...allOk(), ...change }, now);
    assert.equal(verdict.level, "problem", label);
    assert.equal(verdict.reasons[0].text, text, label);
  }
  const mixed = securityVerdict({ ...allOk(), admins: [{ isActive: true, twoFactorOn: false, lockedUntil: null }], incidents: [{ severity: "HIGH" }, { severity: "LOW" }] }, now);
  assert.equal(mixed.level, "problem");
  assert.deepEqual(mixed.reasons.map((r) => [r.level, r.code]), [["problem", "incident-high"], ["attention", "incident"], ["attention", "no-2fa"]]);
});

test("verdict thresholds and edge cases", () => {
  assert.deepEqual(STATUS_THRESHOLDS, { failedSpikeMin: 20, failedSpikeFactor: 3, adminFailedAttention: 3, adminFailedProblem: 10 });
  // Spike: needs >= 20 AND >= 3 x previous (previous 0 counts as 1).
  assert.equal(isFailedLoginSpike(19, 0), false);
  assert.equal(isFailedLoginSpike(20, 0), true);
  assert.equal(isFailedLoginSpike(20, 7), false, "20 < 21");
  assert.equal(isFailedLoginSpike(21, 7), true);
  assert.equal(isFailedLoginSpike(500, 400), false, "steady high traffic is not a spike");
  // Admin-account attempts: 2 calm, 3..9 attention, 10+ problem.
  assert.equal(securityVerdict({ ...allOk(), adminFailed24h: 2 }, now).level, "ok");
  assert.equal(securityVerdict({ ...allOk(), adminFailed24h: 9 }, now).level, "attention");
  // An INACTIVE admin without 2FA is not flagged; a lock that already ended is not flagged.
  assert.equal(securityVerdict({ ...allOk(), admins: [{ isActive: false, twoFactorOn: false, lockedUntil: null }] }, now).level, "ok");
  assert.equal(securityVerdict({ ...allOk(), admins: [{ isActive: true, twoFactorOn: true, lockedUntil: now }] }, now).level, "ok", "lock ending exactly now is over");
  // Counts are summed: 2 admins without 2FA -> one reason with 2.
  assert.deepEqual(securityVerdict({ ...allOk(), admins: [{ isActive: true, twoFactorOn: false, lockedUntil: null }, { isActive: true, twoFactorOn: false, lockedUntil: null }] }, now).reasons.map((r) => r.text), [STATUS_TEXT.noTwoFactor(2)]);
  // Several blocks unavailable -> one calm reason, not one per block.
  assert.deepEqual(securityVerdict({ ...allOk(), admins: null, failed: null, adminFailed24h: null, incidents: null }, now).reasons.map((r) => r.code), ["unavailable"]);
});

// ================================================================= sessions and buckets

test("active admin session = not revoked, not expired, used within the admin idle timeout (2 h)", () => {
  const base = { revokedAt: null, expiresAt: new Date(now.getTime() + 8 * HOUR), lastSeenAt: new Date(now.getTime() - HOUR), createdAt: new Date(now.getTime() - 5 * HOUR) };
  assert.equal(isAdminSessionActive(base, now), true);
  assert.equal(isAdminSessionActive({ ...base, revokedAt: now }, now), false);
  assert.equal(isAdminSessionActive({ ...base, expiresAt: now }, now), false);
  assert.equal(isAdminSessionActive({ ...base, lastSeenAt: new Date(now.getTime() - ADMIN_IDLE_TIMEOUT_MS - 1) }, now), false, "idle");
  assert.equal(isAdminSessionActive({ ...base, lastSeenAt: null, createdAt: new Date(now.getTime() - 30 * 60 * 1000) }, now), true, "never seen: uses createdAt");
  assert.equal(ADMIN_IDLE_TIMEOUT_MS, 2 * HOUR);
});

test("Baku days: UTC+4 day keys, last 7 days, and the 7-day lower bound", () => {
  assert.equal(bakuDayKey(new Date("2026-11-22T19:59:59Z")), "2026-11-22");
  assert.equal(bakuDayKey(new Date("2026-11-22T20:00:00Z")), "2026-11-23", "20:00 UTC is midnight in Baku");
  assert.deepEqual(lastBakuDays(now, 7), ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"]);
  assert.equal(bakuDaysStart(now, 7).toISOString(), "2026-11-16T20:00:00.000Z");
});

test("daily failed logins: every day present (zeros), split by login type with the existing labels, outside rows ignored", () => {
  const days = lastBakuDays(now, 7);
  const result = dailyFailedLogins([
    { day: "2026-11-23", path: "/api/auth/login", count: 5 },
    { day: "2026-11-23", path: "/api/admin/login", count: 2 },
    { day: "2026-11-23", path: "/api/admin/login/2fa", count: 1 },
    { day: "2026-11-20", path: "/api/auth/vendor-login", count: 3 },
    { day: "2026-11-01", path: "/api/auth/login", count: 99 },
  ], days);
  assert.deepEqual(result.buckets.map((b) => b.total), [0, 0, 0, 3, 0, 0, 8]);
  assert.deepEqual(result.buckets[6].byType, { "Müştəri girişi": 5, "Admin girişi": 2, "Admin 2FA": 1 });
  assert.deepEqual(result.types, ["Müştəri girişi", "Satıcı girişi", "Admin girişi", "Admin 2FA"]);
  assert.deepEqual(dailyFailedLogins([], days).buckets.map((b) => b.total), [0, 0, 0, 0, 0, 0, 0], "empty: seven zero days");
  assert.deepEqual(dailyFailedLogins([], days).types, []);
});

test("hourly failed logins: 24 hours, Baku labels, counts from UTC hour keys, zeros filled", () => {
  const hours = hourlyFailedLogins([{ hour: "2026-11-23T12", count: 4 }, { hour: "2026-11-23T08", count: 1 }, { hour: "2026-11-20T08", count: 50 }], now);
  assert.equal(hours.length, 24);
  assert.equal(hours[23].key, "2026-11-23T12");
  assert.equal(hours[23].label, "16:00", "12 UTC = 16 Baku");
  assert.equal(hours[23].count, 4);
  assert.equal(hours.find((h) => h.key === "2026-11-23T08")?.count, 1);
  assert.equal(hours.reduce((s, h) => s + h.count, 0), 5, "older rows are not in the window");
  assert.equal(hours[0].key, "2026-11-22T13");
  assert.equal(deviceText("  Chrome 140 · Windows "), "Chrome 140 · Windows");
  assert.equal(deviceText(null), "—");
});

// ================================================================= data, access, masking

test("data: new queries are aggregated in SQL, bounded, UTC-safe and read-only", () => {
  const data = read("lib/security-center-data.ts");
  const trend = data.slice(data.indexOf("export async function loadFailedLoginTrend"), data.indexOf("export async function loadActiveAdminSessionCount"));
  assert.match(trend, /GROUP BY 1, 2 ORDER BY 1 LIMIT 60/);
  assert.match(trend, /GROUP BY 1 ORDER BY 1 LIMIT 30/);
  assert.match(trend, /"occurredAt" >= \$\{utcTimestamp\(since7days\)\}/);
  assert.match(trend, /"occurredAt" >= \$\{utcTimestamp\(since24h\)\}/);
  assert.match(trend, /to_char\("occurredAt" \+ INTERVAL '4 hours', 'YYYY-MM-DD'\)/);
  assert.match(data, /COUNT\(\*\) FILTER \(WHERE "occurredAt" >= \$\{utcTimestamp\(since48h\)\} AND "occurredAt" < \$\{utcTimestamp\(since24h\)\}\)::int AS "prev24h"/);
  const count = data.slice(data.indexOf("export async function loadActiveAdminSessionCount"));
  assert.match(count, /tx\.authSession\.count\(\{\n    where: \{\n      user: \{ role: "ADMIN" \}, revokedAt: null, expiresAt: \{ gt: now \},\n      OR: \[\{ lastSeenAt: \{ gte: idleSince \} \}, \{ lastSeenAt: null, createdAt: \{ gte: idleSince \} \}\],/);
  assert.match(data, /active: isAdminSessionActive\(session, now\)/);
  // Every block is still a bounded read; the only write is the existing full-IP audit row.
  assert.doesNotMatch(data, /\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\((?![^)]*SECURITY_FULL_IP_VIEW)/);
  for (const take of data.matchAll(/take: (\d+)/g)) assert.ok(Number(take[1]) <= 100);
  for (const limit of data.matchAll(/LIMIT (\d+)/g)) assert.ok(Number(limit[1]) <= 60);
});

test("page: admin + security.view first, full IP only after the audit row, every IP output masked unless revealed", () => {
  const page = read("app/admin/security-center/page.tsx");
  const order = ['requireRole("ADMIN")', 'requireSecurityPermission(admin, "security.view")', 'redirect("/admin/login")', 'await recordFullIpView(admin.id, "summary")', "await loadAdmins()"];
  for (let i = 1; i < order.length; i += 1) assert.ok(page.indexOf(order[i - 1]) < page.indexOf(order[i]), `${order[i - 1]} before ${order[i]}`);
  // Every IP shown goes through the masking rule: shownIp(raw, masked, full), loginIp (full && ipFull, else masked), or
  // the admin-failed row (full ? ip : maskIpAddress(ip)).
  const ipOutputs = [...page.matchAll(/<Ip value=\{([^}]*(?:\}[^}]*)?)\} \/>/g)].map((m) => m[1]);
  assert.ok(ipOutputs.length >= 6);
  for (const expr of ipOutputs) assert.ok(/^shownIp\(.*, full\)$|^loginIp\((row|lastLogin)\)$|^row\.ip \? \(full \? row\.ip : maskIpAddress\(row\.ip\)\) : null$/.test(expr), `IP output: ${expr}`);
  assert.match(page, /const loginIp = \(row: \{ ipFull: string \| null; ipMasked: string \| null \}\) => full && row\.ipFull \? row\.ipFull : row\.ipMasked \?\? \(row\.ipFull \? maskIpAddress\(row\.ipFull\) : null\);/);
  assert.doesNotMatch(page, /\{row\.sourceIp\}|\{row\.ipFull\}|\{row\.raw\}/, "no raw IP printed directly");
  // The reveal stays the audited GET form; no auto-refresh, no client code.
  assert.match(page, /<form method="get" action="\/admin\/security-center"><input type="hidden" name="ip" value="full" \/><button[^>]*>Tam IP-ləri göstər<\/button><\/form>/);
  assert.doesNotMatch(page, /setInterval|"use client"|router\.refresh/);
  assert.match(page, /Səhifə avtomatik yenilənmir\./);
});

test("page: verdict banner with icon + text, summary cards, charts with empty states, latest 10 + show more, related pages", () => {
  const page = read("app/admin/security-center/page.tsx");
  assert.match(page, /<section aria-labelledby="security-verdict" data-security-verdict=\{verdict\.level\}/);
  assert.match(page, /<banner\.Icon size=\{28\} aria-hidden="true"/, "status icon next to the text");
  assert.match(page, /<h2 id="security-verdict" className="text-xl font-semibold">\{banner\.title\}<\/h2>/);
  assert.match(page, /: <p className="mt-1 text-sm">\{STATUS_TEXT\.checked\}<\/p>/);
  for (const title of ["twoFactorTitle", "failed24hTitle", "failed7dTitle", "sessionsTitle", "lastLoginTitle"]) assert.ok(page.includes(`DASHBOARD_TEXT.${title}`), title);
  assert.match(page, /title="IP yoxlaması"/);
  assert.match(page, /allClear\("Son 7 gündə uğursuz giriş yoxdur\."\)/);
  assert.match(page, /allClear\(DASHBOARD_TEXT\.noFailed24h\)/);
  assert.match(page, /const LATEST = 10;/);
  assert.match(page, /logins\.slice\(0, LATEST\)\.map\(loginRow\)/);
  assert.match(page, /<details className="mt-3 group"><summary[^>]*>\{DASHBOARD_TEXT\.showMore\(logins\.length - LATEST\)\}<\/summary>/);
  for (const href of ["/admin/security/sessions", "/admin/audit-log", "/admin/system", "/admin/security", "/admin/security-center/events", "/admin/security-center/incidents"]) assert.ok(page.includes(`"${href}"`), href);
  // Status badges are icon + text.
  assert.match(page, /<Icon size=\{12\} aria-hidden="true"\/>\{children\}<\/span>/);
  // Charts: accessible (title per segment / bar, screen-reader table); no chart package.
  const stacked = read("components/stacked-column-chart.tsx");
  assert.match(stacked, /<title>\{`\$\{column\.label\} · \$\{name\}: \$\{value\}`\}<\/title>/);
  assert.match(stacked, /<div className="sr-only"><table>/);
  const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
  assert.equal(Object.keys(pkg.dependencies).some((name) => /chart|recharts|d3|visx|nivo/i.test(name)), false);
});

test("live-check fixes: no React key carries an IP; the chart's screen-reader table cannot widen a phone page", () => {
  const page = read("app/admin/security-center/page.tsx");
  // React keys are serialized into the page's embedded data even when the shown IP is masked.
  assert.doesNotMatch(page, /key=\{[^}]*\b(row\.key|raw|sourceIp|ipFull|row\.ip)\b[^}]*\}/);
  assert.match(page, /suspicious\.topIps\.map\(\(row, index\) => <tr key=\{`top-ip-\$\{index\}`\}>/);
  // A <table> ignores sr-only's 1 px width: the wrapper carries sr-only.
  const stacked = read("components/stacked-column-chart.tsx");
  assert.match(stacked, /<div className="sr-only"><table><caption>\{title\}<\/caption>/);
  assert.doesNotMatch(stacked, /<table className="sr-only">/);
});

test("no protection claims and nothing about WAF / Cloudflare data", () => {
  const sources = [read("app/admin/security-center/page.tsx"), read("lib/security-center-status.ts")].join("\n");
  assert.doesNotMatch(sources, /\bWAF\b|qorunur|təhlükəsizdir|tam qorunma|100%/i);
  assert.doesNotMatch(read("lib/security-center-status.ts"), /cloudflare/i);
});

// ================================================================= public site untouched, texts

function files(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d)) { const f = join(d, e); if (statSync(f).isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(e)) out.push(relative(root, f).replace(/\\/g, "/")); } };
  walk(resolve(root, dir));
  return out;
}

test("internal only: no public page or legal page mentions the security center; legal pages byte-identical", () => {
  const baseText = (path: string) => execFileSync("git", ["show", `${BASE}:${path}`], { cwd: root, encoding: "utf8" }).replace(/\r\n/g, "\n");
  for (const path of ["app/(customer)/terms/page.tsx", "app/(customer)/privacy/page.tsx", "app/(customer)/seller-terms/page.tsx"]) assert.equal(read(path), baseText(path), path);
  for (const path of files("app/(customer)")) assert.doesNotMatch(read(path), /security-center|Təhlükəsizlik mərkəzi|STATUS_TEXT|DASHBOARD_TEXT/, path);
});

test("texts: only the listed new texts appear in the changed files (scan against main)", () => {
  const baseText = (path: string) => { try { return execFileSync("git", ["show", `${BASE}:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).replace(/\r\n/g, "\n"); } catch { return ""; } };
  const NEW_TEXTS = [
    "Diqqət tələb edən heç nə tapılmadı", "Diqqət tələb edir", "Problem var",
    "Yoxlanılan: adminlərin 2FA-sı, 2FA kilidləri, uğursuz girişlər, admin hesablarına cəhdlər, IP-nin tanınması və açıq insidentlər.",
    "aktiv admin hesabında iki mərhələli təsdiq qoşulmayıb.", "admin hesabının 2FA girişi müvəqqəti kilidlənib.", "IP yoxlaması:",
    "Son 24 saatda uğursuz girişlər artıb:", "əvvəlki 24 saatda", "Son 24 saatda admin hesablarına", "uğursuz giriş cəhdi olub.",
    "açıq yüksək riskli insident var.", "açıq insident var.", "Bəzi məlumatlar yüklənmədi; vəziyyət tam yoxlanmayıb.",
    "Adminlərin 2FA-sı", "aktiv admin hesabında qoşulub", "Uğursuz girişlər · son 24 saat", "Əvvəlki 24 saat:", "Uğursuz girişlər · son 7 gün",
    "Bütün giriş səhifələri üzrə", "Aktiv admin sessiyaları", "Son 2 saatda istifadə olunub", "Son admin girişi", "uğursuz giriş",
    "Daha çox göstər", "Əlaqəli səhifələr", "Son 24 saatda uğursuz giriş yoxdur.",
  ];
  // Existing texts reused in a new place (each must exist in the base commit).
  const REUSED: Array<[string, string]> = [
    ["Aktiv sessiyalar", "app/admin/security/sessions/page.tsx"], ["Audit jurnalı", "app/admin/audit-log/page.tsx"],
    ["Sistem vəziyyəti", "components/admin-system-status.tsx"], ["Saxtalaşdırma testi", "lib/admin-ip-spoof-test.ts"],
    ["Hesab təhlükəsizliyi", "app/admin/security/page.tsx"], ["Ətraflı hadisələr", "app/admin/security-center/events/page.tsx"],
    ["İnsidentlər və qaydalar", "app/admin/security-center/page.tsx"], ["Son 7 gündə uğursuz giriş yoxdur.", "app/admin/security-center/page.tsx"],
    ["Açıq insident yoxdur.", "app/admin/security-center/page.tsx"], ["Müştəri girişi", "lib/security-center-view.ts"],
  ];
  for (const [text, path] of REUSED) assert.ok(baseText(path).includes(text), `reused text exists before: ${text}`);
  const AZ = /[əğıöüşçƏĞİÖÜŞÇ]/;
  const fragments = (source: string) => new Set(source.split(/["'`<>{}]|\$\{/).map((p) => p.trim()).filter((p) => AZ.test(p)));
  const changed = ["app/admin/security-center/page.tsx", "lib/security-center-status.ts", "lib/security-center-data.ts", "components/stacked-column-chart.tsx"];
  const allBefore = changed.map(baseText).join("\n") + "\n" + REUSED.map(([, p]) => baseText(p)).join("\n");
  for (const path of changed) {
    const before = fragments(baseText(path));
    for (const fragment of fragments(read(path))) {
      if (before.has(fragment)) continue;
      let rest = fragment;
      for (const text of [...NEW_TEXTS, ...REUSED.map(([t]) => t)].sort((a, b) => b.length - a.length)) rest = rest.split(text).join("");
      const unknown = (rest.match(/[A-Za-zƏəĞğİıÖöÜüŞşÇç0-9-]+/g) ?? []).filter((word) => AZ.test(word) && !allBefore.includes(word) && !NEW_TEXTS.some((t) => t.includes(word)));
      assert.deepEqual(unknown, [], `${path}: unlisted new text: ${fragment}`);
    }
  }
  for (const value of Object.values(DASHBOARD_TEXT)) if (typeof value === "string") assert.ok(NEW_TEXTS.some((t) => value.includes(t) || t.includes(value)), value);
});
