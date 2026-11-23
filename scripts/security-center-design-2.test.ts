/**
 * SECURITY-CENTER-DESIGN-2: the security center as a short overview + tabs. Unit tests only: the verdict reasons and
 * their links, scan noise, the "needs attention" list, the refresh rules, the tab structure, masking, the incident
 * actions (existing endpoint only), bounded reads and the new texts.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import {
  attentionIncidents, AUTO_REFRESH, autoRefreshStep, bakuClock, CENTER_TEXT, INCIDENT_HELP, incidentTotals, isScanNoise, refreshOutcome, ruleName,
  SCAN_NOISE_RULE_KEYS, SECURITY_TABS, securityVerdict, STATUS_TEXT, type StatusInput,
} from "../lib/security-center-status";
import { SECURITY_ALERT_RULES } from "../lib/security-monitoring/rules";
import { EVENTS_PAGE_SIZE } from "../lib/security-center-view";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const BASE = "962124e"; // main before SECURITY-CENTER-DESIGN-2
const now = new Date("2026-11-23T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

const allOk = (): StatusInput => ({
  admins: [{ isActive: true, twoFactorOn: true, lockedUntil: null }],
  failed: { last24h: 2, prev24h: 1 },
  adminFailed24h: 0,
  ip: { tone: "good", title: "IP düzgün tanınır" },
  incidents: [],
});

const PAGES = {
  overview: "app/admin/security-center/page.tsx",
  incidents: "app/admin/security-center/incidents/page.tsx",
  logins: "app/admin/security-center/logins/page.tsx",
  events: "app/admin/security-center/events/page.tsx",
  audit: "app/admin/security-center/audit/page.tsx",
} as const;

// ================================================================= verdict reasons

test("verdict: every reason says what it is and links to where it is handled", () => {
  const cases: Array<[Partial<StatusInput>, string, string, string]> = [
    [{ ip: { tone: "bad", title: "IP tanınmır" } }, "ip-bad", "/admin/system", "Sistem vəziyyəti"],
    [{ ip: { tone: "warn", title: "IP tanınmır" } }, "ip-warn", "/admin/system", "Sistem vəziyyəti"],
    [{ incidents: [{ severity: "HIGH", ruleKey: "ip_header_mismatch" }] }, "incident-high", "#needs-attention", CENTER_TEXT.seeBelow],
    [{ incidents: [{ severity: "MEDIUM", ruleKey: "rate_limit_spike" }] }, "incident", "#needs-attention", CENTER_TEXT.seeBelow],
    [{ adminFailed24h: 4 }, "admin-failed", "/admin/security-center/logins", CENTER_TEXT.seeLogins],
    [{ adminFailed24h: 12 }, "admin-failed", "/admin/security-center/logins", CENTER_TEXT.seeLogins],
    [{ failed: { last24h: 40, prev24h: 2 } }, "spike", "/admin/security-center/logins", CENTER_TEXT.seeLogins],
    [{ admins: [{ isActive: true, twoFactorOn: false, lockedUntil: null }] }, "no-2fa", "/admin/security", "Hesab təhlükəsizliyi"],
    [{ admins: [{ isActive: true, twoFactorOn: true, lockedUntil: new Date(now.getTime() + HOUR) }] }, "locked", "/admin/security", "Hesab təhlükəsizliyi"],
  ];
  for (const [change, code, href, action] of cases) {
    const reason = securityVerdict({ ...allOk(), ...change }, now).reasons.find((item) => item.code === code);
    assert.ok(reason, code);
    assert.equal(reason.href, href, code);
    assert.equal(reason.action, action, code);
  }
  // "unavailable" has no page: the banner shows the retry hint next to it.
  const unavailable = securityVerdict({ ...allOk(), incidents: null }, now).reasons;
  assert.deepEqual(unavailable.map((r) => [r.code, r.href]), [["unavailable", undefined]]);
});

test("verdict: incident reasons name the rules, count every open incident, and leave scan noise out", () => {
  const verdict = securityVerdict({ ...allOk(), incidents: [
    { severity: "HIGH", ruleKey: "ip_header_mismatch", count: 2 },
    { severity: "MEDIUM", ruleKey: "rate_limit_spike", count: 3 },
    { severity: "MEDIUM", ruleKey: "auth_denied_spike", count: 1 },
    { severity: "MEDIUM", ruleKey: "not_found_scan", count: 40 },
  ] }, now);
  assert.equal(verdict.level, "problem");
  assert.deepEqual(verdict.reasons.map((r) => r.text), [
    STATUS_TEXT.highIncidents(2, ["IP başlıqları uyğun gəlmir"]),
    STATUS_TEXT.incidents(4, ["429 (limit) cavablarında artım", "401/403 cavablarında artım"]),
  ]);
  assert.equal(verdict.reasons[0].text, "2 açıq yüksək riskli insident var: IP başlıqları uyğun gəlmir.");
  // Only background scanning open: calm, no reason at all.
  assert.deepEqual(securityVerdict({ ...allOk(), incidents: [{ severity: "MEDIUM", ruleKey: "not_found_scan", count: 500 }] }, now), { level: "ok", reasons: [] });
  // Even a scan incident someone raised to HIGH is not a problem (the rule key decides).
  assert.equal(securityVerdict({ ...allOk(), incidents: [{ severity: "HIGH", ruleKey: "not_found_scan" }] }, now).level, "ok");
  // DESIGN-1 shape (one row per incident, no rule key) still works and keeps the DESIGN-1 text.
  assert.deepEqual(securityVerdict({ ...allOk(), incidents: [{ severity: "HIGH" }, { severity: "HIGH" }] }, now).reasons.map((r) => r.text), [STATUS_TEXT.highIncidents(2)]);
  assert.deepEqual(SCAN_NOISE_RULE_KEYS, ["not_found_scan"]);
  assert.equal(isScanNoise("not_found_scan"), true);
  assert.equal(isScanNoise("ip_header_mismatch"), false);
  assert.equal(isScanNoise(null), false);
  assert.equal(ruleName("unknown_rule"), "unknown_rule");
  assert.deepEqual(incidentTotals([{ severity: "CRITICAL", ruleKey: "two_factor_failures", count: 1 }, { severity: "LOW", ruleKey: "x", count: 2 }, { severity: "MEDIUM", ruleKey: "not_found_scan", count: 9 }]), { high: 1, other: 2, scan: 9 });
});

test("needs attention: at most 5, no scan noise, highest severity first, then newest", () => {
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * HOUR);
  const rows = [
    { id: "a", ruleKey: "rate_limit_spike", severity: "MEDIUM", createdAt: at(1) },
    { id: "b", ruleKey: "not_found_scan", severity: "HIGH", createdAt: at(0) },
    { id: "c", ruleKey: "ip_header_mismatch", severity: "HIGH", createdAt: at(5) },
    { id: "d", ruleKey: "two_factor_failures", severity: "CRITICAL", createdAt: at(9) },
    { id: "e", ruleKey: "ip_header_mismatch", severity: "HIGH", createdAt: at(2) },
    { id: "f", ruleKey: "auth_denied_spike", severity: "LOW", createdAt: at(0) },
    { id: "g", ruleKey: "server_error_spike", severity: "MEDIUM", createdAt: at(3) },
  ];
  assert.deepEqual(attentionIncidents(rows).map((row) => row.id), ["d", "e", "c", "a", "g"]);
  assert.equal(attentionIncidents([]).length, 0);
  const page = read(PAGES.overview);
  assert.match(page, /const attention = incidents \? attentionIncidents\(incidents\.list\) : \[\];/);
  assert.equal((page.match(/data-attention-list=""/g) ?? []).length, 1, "one list only");
});

test("every alert rule has a plain one-line explanation and an internal admin link", () => {
  for (const rule of SECURITY_ALERT_RULES) {
    const help = INCIDENT_HELP[rule.key];
    assert.ok(help, rule.key);
    assert.ok(help.text.length <= 140, `${rule.key}: one line`);
    assert.match(help.href, /^\/admin\//, rule.key);
    assert.doesNotMatch(help.text, /hücum|təcili|dərhal|kritik/i, `${rule.key}: calm wording`);
  }
  assert.deepEqual(Object.keys(INCIDENT_HELP).sort(), SECURITY_ALERT_RULES.map((rule) => rule.key).sort());
});

// ================================================================= refresh

test("refresh rules: off by default, 60 s, visible tab only, never overlapping, stops after 60 runs or a failure", () => {
  assert.deepEqual(AUTO_REFRESH, { seconds: 60, maxRuns: 60 });
  assert.equal(autoRefreshStep({ visible: true, pending: false, runs: 0 }), "refresh");
  assert.equal(autoRefreshStep({ visible: false, pending: false, runs: 3 }), "wait", "hidden tab: nothing sent");
  assert.equal(autoRefreshStep({ visible: true, pending: true, runs: 3 }), "wait", "a refresh is still running");
  assert.equal(autoRefreshStep({ visible: true, pending: false, runs: 59 }), "refresh");
  assert.equal(autoRefreshStep({ visible: true, pending: false, runs: 60 }), "stop");
  assert.equal(refreshOutcome("2026-11-23T12:00:00.000Z", "2026-11-23T12:00:05.120Z"), "ok");
  assert.equal(refreshOutcome("2026-11-23T12:00:00.000Z", "2026-11-23T12:00:00.000Z"), "failed", "same render time: the server did not render again");
  assert.equal(bakuClock("2026-11-23T20:05:09.000Z"), "00:05:09", "UTC+4");
  assert.equal(bakuClock("nonsense"), "—");
  assert.equal(CENTER_TEXT.lastRefresh(bakuClock("2026-11-23T12:00:00.000Z")), "Son yenilənmə: 16:00:00");
});

test("refresh button: router.refresh in a transition, busy state, render time shown, auto switch bounded and cleaned up", () => {
  const ui = read("components/security-refresh.tsx");
  assert.match(ui, /^"use client";/);
  assert.match(ui, /startTransition\(\(\) => router\.refresh\(\)\);/);
  assert.match(ui, /disabled=\{pending\} aria-busy=\{pending\}/);
  assert.match(ui, /\{CENTER_TEXT\.lastRefresh\(bakuClock\(renderedAt\)\)\}/);
  assert.match(ui, /const \[auto, setAuto\] = useState\(false\);/, "auto-refresh OFF by default");
  assert.match(ui, /document\.visibilityState === "visible"/);
  assert.match(ui, /if \(outcome === "failed"\) setAuto\(false\);/, "stops on errors");
  assert.match(ui, /if \(step === "stop"\) \{ setAuto\(false\); setResult\("stopped"\); return; \}/);
  assert.match(ui, /return \(\) => \{ if \(timer\) clearTimeout\(timer\); \};/);
  assert.match(ui, /setTimeout\(tick, AUTO_REFRESH\.seconds \* 1000\)/);
  assert.doesNotMatch(ui, /setInterval/);
  assert.match(ui, /<p role="status" aria-live="polite"/);
  // Every tab renders the header with the server render time.
  for (const [tab, path] of Object.entries(PAGES)) {
    const source = read(path);
    assert.match(source, new RegExp(`<SecurityCenterHeader active="${tab}" renderedAt=\\{(now\\.toISOString\\(\\)|renderedAt)\\}`), path);
  }
  // The incidents tab list reloads when the page re-renders.
  assert.match(read(PAGES.incidents), /<AdminSecurityMonitoring refreshedAt=\{renderedAt\} \/>/);
  assert.match(read("components/admin-security-monitoring.tsx"), /useEffect\(\(\) => \{ void load\(\); \}, \[load, refreshedAt\]\);/);
});

test("auto-refresh never runs while full IPs are shown (no repeated SECURITY_FULL_IP_VIEW rows)", () => {
  // The rule: fullIp stops the timer whatever else is true.
  assert.equal(autoRefreshStep({ visible: true, pending: false, runs: 0, fullIp: true }), "stop");
  assert.equal(autoRefreshStep({ visible: true, pending: false, runs: 0, fullIp: false }), "refresh");
  const ui = read("components/security-refresh.tsx");
  assert.match(ui, /export default function SecurityRefresh\(\{ renderedAt, fullIp = false \}: \{ renderedAt: string; fullIp\?: boolean \}\)/);
  assert.match(ui, /useEffect\(\(\) => \{ if \(fullIp\) setAuto\(false\); \}, \[fullIp\]\);/, "the switch turns itself off");
  assert.match(ui, /if \(!auto \|\| fullIp\) return;/, "no timer is started while full IPs are shown");
  assert.match(ui, /autoRefreshStep\(\{ visible: document\.visibilityState === "visible", pending: pendingRef\.current, runs, fullIp \}\)/);
  assert.match(ui, /checked=\{auto && !fullIp\} disabled=\{fullIp\}/, "it cannot be switched on");
  assert.match(ui, /onChange=\{\(event\) => \{ setAuto\(event\.target\.checked && !fullIp\); setResult\(null\); \}\}/);
  assert.match(ui, /\{fullIp && <p id="auto-refresh-full-ip" className="text-xs text-slate-500" data-auto-off-full-ip="">\{CENTER_TEXT\.autoOffFullIp\}<\/p>\}/);
  assert.equal(CENTER_TEXT.autoOffFullIp, "Tam IP-lər göstərilərkən avtomatik yeniləmə işləmir.");
  // The header passes it on; every page that can reveal IPs passes its audited `full` flag.
  assert.match(read("components/security-center-ui.tsx"), /<SecurityRefresh renderedAt=\{renderedAt\} fullIp=\{fullIp\}\/>/);
  for (const path of [PAGES.overview, PAGES.logins, PAGES.events]) assert.match(read(path), /<SecurityCenterHeader active="\w+" renderedAt=\{now\.toISOString\(\)\} fullIp=\{full\} actions=/, path);
});

test("live-check layout fixes: phone rows put buttons under the text; events tables and filters fit at 1280", () => {
  const overview = read(PAGES.overview);
  // At 390 px the buttons squeezed the incident text into a narrow column: on phones the text takes the full row.
  assert.match(overview, /<div className="min-w-0 flex-1 max-sm:basis-full">\n\s+<div className="flex flex-wrap items-center gap-2"><SeverityBadge/);
  assert.match(overview, /<span className="min-w-\[14rem\] flex-1">\{reason\.text\}<\/span>/, "the reason link wraps below on phones");
  assert.match(read("components/admin-security-monitoring.tsx"), /<div className="min-w-0 flex-1 max-sm:basis-full">\n\s+<div className="flex flex-wrap items-center gap-2">\n\s+<Badge tone=\{SEVERITY_TONES/);
  // At 1280 the half-width top-IP table was cut off and the filter selects overlapped.
  const events = read(PAGES.events);
  assert.match(events, /\{!suspicious \? unavailable : <div className="grid gap-5">/);
  assert.match(events, /const field = "min-h-11 w-full min-w-0 rounded-xl/);
});

// ================================================================= tabs

test("tabs: five sections with existing titles where they exist, each page admin-only, server-rendered and bounded", () => {
  assert.deepEqual(SECURITY_TABS.map((tab) => [tab.id, tab.href, tab.label]), [
    ["overview", "/admin/security-center", "Ümumi baxış"],
    ["incidents", "/admin/security-center/incidents", "İnsidentlər"],
    ["logins", "/admin/security-center/logins", "Girişlər"],
    ["events", "/admin/security-center/events", "Hadisələr"],
    ["audit", "/admin/security-center/audit", "Audit"],
  ]);
  const ui = read("components/security-center-ui.tsx");
  assert.match(ui, /aria-current=\{active === tab\.id \? "page" : undefined\}/);
  assert.match(ui, /<nav aria-label="Təhlükəsizlik mərkəzi bölmələri"/);
  for (const path of Object.values(PAGES)) {
    assert.ok(existsSync(resolve(root, path)), path);
    const source = read(path);
    const a = source.indexOf('requireRole("ADMIN")'), b = source.indexOf('requireSecurityPermission(admin, "security.view")'), c = source.indexOf('redirect("/admin/login")');
    assert.ok(a > 0 && a < b && b < c, `${path}: admin + security.view first`);
    assert.match(source, /export const dynamic = "force-dynamic";/, path);
    assert.doesNotMatch(source, /"use client"|setInterval/, path);
  }
});

test("overview is short: the long blocks moved to their tabs, no long tables on the overview", () => {
  const overview = read(PAGES.overview);
  for (const [title, path] of [
    ["Son admin girişləri", PAGES.logins], ["Uğursuz girişlər", PAGES.logins], ["Adminlər və iki mərhələli təsdiq", PAGES.logins],
    ["Şübhəli fəaliyyət", PAGES.events], ["Ən çox qeydə alınan IP-lər (7 gün)", PAGES.events], ["Ətraflı hadisələr", PAGES.events],
    ["Son təhlükəsizlik əməliyyatları", PAGES.audit],
  ] as const) {
    assert.ok(read(path).includes(title), `${title} in ${path}`);
    assert.ok(!overview.includes(`title="${title}"`) && !overview.includes(`>${title}<`), `${title} not a block on the overview`);
  }
  assert.doesNotMatch(overview, /<table|RowTable|LimitedRows|<details/);
  for (const marker of ["data-security-verdict", "data-security-cards", "data-attention-list", 'data-failed-chart="7d"', 'data-failed-chart="24h"', "data-scan-card"]) assert.ok(overview.includes(marker), marker);
  // Section rows: at most 10 visible, the rest behind "Daha çox göstər" or paging.
  const logins = read(PAGES.logins);
  assert.match(logins, /const LATEST = 10;/);
  assert.match(logins, /const FEW = 5;/);
  assert.match(read(PAGES.events), /const FEW = 5;/);
  assert.equal(EVENTS_PAGE_SIZE, 10);
  assert.match(read("lib/security-center-data.ts"), /export const AUDIT_PAGE_SIZE = 10;\nexport const AUDIT_MAX_PAGES = 50;/);
  // Tables become cards below 640 px (data-label per cell), so phones never scroll sideways.
  const ui = read("components/security-center-ui.tsx");
  assert.match(ui, /<td key=\{head\[index\] \?\? index\} data-label=\{head\[index\]\}/);
  assert.match(ui, /max-sm:before:content-\[attr\(data-label\)\]/);
  assert.match(ui, /<thead className="[^"]*max-sm:hidden">/);
});

test("scan card: calm, not counted, explains it is normal, claims no protection", () => {
  const overview = read(PAGES.overview);
  assert.match(overview, /<Badge tone="neutral">\{CENTER_TEXT\.scanBadge\}<\/Badge>/);
  assert.match(overview, /\{CENTER_TEXT\.scanText\}/);
  assert.match(CENTER_TEXT.scanText, /hər saytda normaldır/);
  const texts = [CENTER_TEXT.scanTitle, CENTER_TEXT.scanBadge, CENTER_TEXT.scanText, CENTER_TEXT.scanOpen(3), CENTER_TEXT.attentionNote].join(" ");
  assert.doesNotMatch(texts, /qorun|blok|hücum|təhlükə|WAF|firewall|Cloudflare/i);
  assert.match(read("lib/security-center-data.ts"), /SELECT to_char\("bucketStart" \+ INTERVAL '4 hours', 'YYYY-MM-DD'\) AS "day", COALESCE\(SUM\("notFound"\), 0\)::int AS "count"/);
});

// ================================================================= actions

test("incident actions use only the existing PATCH (CSRF, permission, conflict check, audit) and need security.respond", () => {
  const actions = read("components/security-incident-actions.tsx");
  const urls = [...actions.matchAll(/fetch\(`([^`]+)`/g)].map((m) => m[1]);
  assert.deepEqual(urls, ["/api/admin/security/incidents/${encodeURIComponent(id)}"]);
  assert.match(actions, /method: "PATCH"/);
  assert.match(actions, /body: JSON\.stringify\(\{ expectedStatus, status, comment: null \}\)/);
  assert.match(actions, /patchIncident\(incident\.id, incident\.status, "RESOLVED"\)/, "bulk only resolves");
  assert.doesNotMatch(actions, /setInterval|Promise\.all/, "bulk runs one by one");
  const overview = read(PAGES.overview);
  assert.match(overview, /const canRespond = requireSecurityPermission\(admin, "security\.respond"\);/);
  assert.match(overview, /\{canRespond && \(row\.status === "OPEN" \|\| row\.status === "ACKNOWLEDGED"\) && <IncidentQuickActions id=\{row\.id\} status=\{row\.status\}\/>\}/);
  assert.match(overview, /\{canRespond && incidents && <ScanBulkResolve incidents=\{incidents\.scan\}\/>\}/);
  // The result messages survive the refresh that removes the last item: the holders sit outside the conditionals.
  assert.match(overview, /<div className="mt-3"><IncidentMessages>\n\s+\{!incidents \? unavailable : !attention\.length \? allClear\("Açıq insident yoxdur\."\) :/);
  assert.match(read("components/security-incident-actions.tsx"), /if \(!incidents\.length\) return done \? <p role="status"/);
  // The bulk list is the bounded scan list (25 oldest open scan incidents).
  assert.match(read("lib/security-center-data.ts"), /ruleKey: \{ in: \[\.\.\.SCAN_NOISE_RULE_KEYS\] \} \},\n      orderBy: \{ createdAt: "asc" \},\n      take: 25,/);
  // The route still enforces it all (unchanged).
  const route = read("app/api/admin/security/incidents/[id]/route.ts");
  assert.match(route, /authorizeSecurityAdmin\(request, "security\.respond", \{ write: true \}\)/);
  // The incidents tab's one-click buttons use the same PATCH with expectedStatus.
  const monitoring = read("components/admin-security-monitoring.tsx");
  assert.match(monitoring, /method: "PATCH", body: JSON\.stringify\(\{ expectedStatus: incident\.status, status: next, comment: null \}\)/);
  assert.doesNotMatch(monitoring, /setInterval|from "@\//);
});

test("data: open incidents counted in full, lists bounded, read-only", () => {
  const data = read("lib/security-center-data.ts");
  assert.match(data, /tx\.securityIncident\.groupBy\(\{ by: \["ruleKey", "severity"\], where: \{ status: \{ in: \[\.\.\.OPEN_STATUSES\] \} \}, _count: \{ _all: true \}, orderBy: \{ ruleKey: "asc" \}, take: 60 \}\)/);
  assert.doesNotMatch(data, /\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\((?![^)]*SECURITY_FULL_IP_VIEW)/);
  for (const take of data.matchAll(/take: (\d+)/g)) assert.ok(Number(take[1]) <= 100);
  for (const limit of data.matchAll(/LIMIT (\d+)/g)) assert.ok(Number(limit[1]) <= 60);
  assert.match(data, /const safePage = Math\.min\(Math\.max\(1, Math\.floor\(page\) \|\| 1\), AUDIT_MAX_PAGES\);/);
});

// ================================================================= masking

test("masking: every IP shown is masked unless the audited reveal ran; no IP in React keys; audit tab shows none", () => {
  const allowed = /^shownIp\(row\.(raw|sourceIp), row\.(masked|sourceIpMasked), full\)$|^loginIp\((row|lastLogin)\)$|^row\.ip \? \(full \? row\.ip : maskIpAddress\(row\.ip\)\) : null$/;
  let outputs = 0;
  for (const path of [PAGES.overview, PAGES.logins, PAGES.events]) {
    const source = read(path);
    for (const match of source.matchAll(/<Ip (?:key="\w+" )?value=\{([^}]*(?:\}[^}]*)?)\} \/>/g)) { outputs += 1; assert.ok(allowed.test(match[1]), `${path}: ${match[1]}`); }
    assert.doesNotMatch(source, /\{row\.sourceIp\}|\{row\.ipFull\}|\{row\.raw\}|\{row\.ip\}/, `${path}: no raw IP printed directly`);
    // A key's own expression (key: x or key={x}); string keys like key="ip" are fixed labels.
    assert.doesNotMatch(source, /key(?:: |=\{)[^,}\n]*\b(row\.key|raw|sourceIp|ipFull|row\.ip)\b/, `${path}: no IP in keys`);
  }
  assert.equal(outputs, 6);
  assert.match(read(PAGES.events), /rows=\{suspicious\.topIps\.map\(\(row, index\) => \(\{ key: `top-ip-\$\{index\}`/);
  assert.match(read(PAGES.logins), /const loginIp = \(row: \{ ipFull: string \| null; ipMasked: string \| null \}\) => full && row\.ipFull \? row\.ipFull : row\.ipMasked \?\? \(row\.ipFull \? maskIpAddress\(row\.ipFull\) : null\);/);
  assert.doesNotMatch(read(PAGES.audit), /Ip|ip=full|recordFullIpView/);
  // The reveal stays the audited GET form; each page records its own view before any IP output.
  const ui = read("components/security-center-ui.tsx");
  assert.match(ui, /<form method="get" action=\{action\}><input type="hidden" name="ip" value="full" \/><button[^>]*>Tam IP-ləri göstər<\/button><\/form>/);
  for (const [path, page, action] of [[PAGES.overview, "summary", "/admin/security-center"], [PAGES.logins, "logins", "/admin/security-center/logins"]] as const) {
    const source = read(path);
    assert.match(source, new RegExp(`const full = wantsFull \\? await recordFullIpView\\(admin\\.id, "${page}"\\) : false;`));
    assert.match(source, new RegExp(`<FullIpToggle action="${action.replace(/\//g, "\\/")}" full=\\{full\\}\\/>`));
    assert.ok(source.indexOf(`recordFullIpView(admin.id, "${page}")`) < source.indexOf("<Ip "), path);
  }
});

// ================================================================= internal only, texts

function files(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d)) { const f = join(d, e); if (statSync(f).isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(e)) out.push(relative(root, f).replace(/\\/g, "/")); } };
  walk(resolve(root, dir));
  return out;
}

test("internal only: no public page or legal page mentions the security center; legal pages byte-identical", () => {
  const baseText = (path: string) => execFileSync("git", ["show", `${BASE}:${path}`], { cwd: root, encoding: "utf8" }).replace(/\r\n/g, "\n");
  for (const path of ["app/(customer)/terms/page.tsx", "app/(customer)/privacy/page.tsx", "app/(customer)/seller-terms/page.tsx"]) assert.equal(read(path), baseText(path), path);
  for (const path of files("app/(customer)")) assert.doesNotMatch(read(path), /security-center|Təhlükəsizlik mərkəzi|CENTER_TEXT|SecurityCenterHeader/, path);
});

test("texts: only the listed new texts appear in the changed files (scan against main)", () => {
  const baseText = (path: string) => { try { return execFileSync("git", ["show", `${BASE}:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).replace(/\r\n/g, "\n"); } catch { return ""; } };
  const NEW_TEXTS = [
    "Ümumi baxış", "Girişlər", "Hadisələr",
    "Aşağıda bax", "Girişlərə bax", "Yeniləyin; təkrarlanarsa, sistem vəziyyətinə baxın.",
    "Diqqət tələb edənlər", "Ən vacib 5 açıq insident. Fon skanı burada sayılmır.", "Ölçülən dəyər:",
    "Fon internet skanı", "Problem sayılmır", CENTER_TEXT.scanText, "Son 24 saat:", "Son 7 gün:", "404 sorğuları · son 7 gün",
    "Son 7 gündə 404 sorğusu yoxdur.", "skan insidenti açıq qalıb. Onlar heç bir addım tələb etmir.", "Skan insidentlərini həll et",
    "skan insidenti", "ediləcək. Hər biri audit jurnalına yazılır.", "Bəli, həll et", "Həll edilir…", "insident həll edildi", "alınmadı.",
    "Son yenilənmə:", "Məlumatlar yeniləndi.", "Yenilənmədi. Bir az sonra yenidən cəhd edin.", "Avtomatik yenilə (60 san)",
    "Avtomatik yeniləmə bir saatdan sonra dayandırıldı.", "Bütün sessiyalar →",
    "Tam IP-lər göstərilərkən avtomatik yeniləmə işləmir.", // text 41, added after "mətnlər ok" (flagged in the report)
    ...Object.values(INCIDENT_HELP).map((help) => help.text),
  ];
  // Existing texts reused in a new place (each must exist in the base commit).
  const REUSED: Array<[string, string]> = [
    ["Bazada qeydə alınmış real məlumat.", "app/admin/security-center/page.tsx"], ["İnsidentin statusu dəyişdi", "lib/audit-action-labels.ts"],
    ["Hamısına bax", "app/(customer)/account/page.tsx"], ["Ətraflı", "components/admin-security-monitoring.tsx"], ["Yenilənir…", "components/reset-password-form.tsx"],
    ["Səhifələr", "app/admin/messages/reports/page.tsx"], ["Ləğv et", "components/admin-security-monitoring.tsx"], ["Qəbul et", "components/admin-security-monitoring.tsx"],
    ["Həll edildi", "components/admin-security-monitoring.tsx"], ["Qəbul edilib", "components/admin-security-monitoring.tsx"], ["Həll edilib", "components/admin-security-monitoring.tsx"],
    ["İnsidentlər və qaydalar", "components/admin-security-monitoring.tsx"], ["Hesab təhlükəsizliyi", "app/admin/security/page.tsx"], ["Sistem vəziyyəti", "components/admin-system-status.tsx"],
    ["Daha çox göstər", "lib/security-center-status.ts"], ["Son təhlükəsizlik əməliyyatları", "app/admin/security-center/page.tsx"],
  ];
  for (const [text, path] of REUSED) assert.ok(baseText(path).includes(text), `reused text exists before: ${text}`);
  const AZ = /[əğıöüşçƏĞİÖÜŞÇ]/;
  const fragments = (source: string) => new Set(source.split(/["'`<>{}]|\$\{/).map((p) => p.trim()).filter((p) => AZ.test(p)));
  const changed = [
    ...Object.values(PAGES), "lib/security-center-status.ts", "lib/security-center-data.ts", "lib/security-center-view.ts",
    "components/security-center-ui.tsx", "components/security-refresh.tsx", "components/security-incident-actions.tsx", "components/admin-security-monitoring.tsx",
  ];
  const allBefore = [...changed, "app/admin/security-center/page.tsx"].map(baseText).join("\n") + "\n" + REUSED.map(([, p]) => baseText(p)).join("\n");
  const known = [...NEW_TEXTS, ...REUSED.map(([t]) => t)].sort((a, b) => b.length - a.length);
  for (const path of changed) {
    const before = new Set([...fragments(baseText(path)), ...fragments(baseText("app/admin/security-center/page.tsx"))]);
    for (const fragment of fragments(read(path))) {
      if (before.has(fragment)) continue;
      let rest = fragment;
      for (const text of known) rest = rest.split(text).join("");
      const unknown = (rest.match(/[A-Za-zƏəĞğİıÖöÜüŞşÇç0-9-]+/g) ?? []).filter((word) => AZ.test(word) && !allBefore.includes(word) && !NEW_TEXTS.some((t) => t.includes(word)));
      assert.deepEqual(unknown, [], `${path}: unlisted new text: ${fragment}`);
    }
  }
  for (const value of Object.values(CENTER_TEXT)) if (typeof value === "string") assert.ok(known.some((t) => value.includes(t) || t.includes(value)), value);
});
