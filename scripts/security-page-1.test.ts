/**
 * SECURITY-PAGE-1: admin security summary, event list, full-IP audit, admin login audit, labels and cleanup.
 * Unit tests only (no database): pure helpers are called directly, wiring is checked in the source.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { AUDIT_ACTION_LABELS, auditActionLabel, SECURITY_AUDIT_ACTIONS } from "../lib/audit-action-labels";
import { adminLoginFailureRow, adminLoginRow, writeAuditInBackground, type AuditRow } from "../lib/admin-login-audit";
import {
  EVENTS_PAGE_SIZE, ipCheckLight, loginAuditBySession, loginMethodLabel, NOT_FOUND_GROUPS, parseEventFilters, portalForPath, portalLabel,
  PRODUCED_EVENT_TYPES, shownIp,
} from "../lib/security-center-view";
import { RETENTION } from "../lib/security-monitoring/jobs";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const before = (source: string, first: string, second: string, label: string) => {
  const a = source.indexOf(first), b = source.indexOf(second, a + 1);
  assert.ok(a >= 0, `${label}: missing ${first}`);
  assert.ok(b > a, `${label}: ${second} must follow ${first}`);
};

function sourceFiles(dir: string): string[] {
  return readdirSync(resolve(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(resolve(root, path)).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

// ---------------------------------------------------------------- labels

test("labels: every literal AuditLog action code written by the app has an Azerbaijani label", () => {
  const codes = new Set<string>();
  for (const file of [...sourceFiles("app"), ...sourceFiles("lib")]) {
    const source = read(file);
    for (const match of source.matchAll(/action: ?"([A-Z][A-Z0-9_]{3,})"/g)) codes.add(match[1]);
    for (const match of source.matchAll(/audit\([^)\n]{0,80}?"([A-Z][A-Z0-9_]{3,})"/g)) codes.add(match[1]);
    for (const match of source.matchAll(/auditAction: "([A-Z][A-Z0-9_]{3,})"/g)) codes.add(match[1]);
    for (const match of source.matchAll(/export const [A-Z_]+ = "([A-Z][A-Z0-9_]{3,})";/g)) if (/AUDIT|ACCEPTED|VIEW/.test(match[0])) codes.add(match[1]);
  }
  for (const match of read("lib/messaging-admin.ts").matchAll(/"(CONVERSATION_[A-Z_]+)"/g)) codes.add(match[1]);
  codes.delete("ORDER_"); // built dynamically: "ORDER_" + status (prefix label below)
  // ADMIN-3-ONBOARD-1 (owner decision): the admin "send for review" action has no visible label yet (no new text without
  // approval); the audit log shows it as its code until a label is approved.
  codes.delete("STORE_SUBMIT_FOR_REVIEW");
  assert.ok(codes.size > 50, `found ${codes.size} codes`);
  const missing = [...codes].filter((code) => !AUDIT_ACTION_LABELS[code]);
  assert.deepEqual(missing, [], "add a label for each new audit action code");
});

test("labels: status-suffixed codes, unknown codes and the security list", () => {
  assert.equal(auditActionLabel("ADMIN_LOGIN"), "Admin girişi");
  assert.equal(auditActionLabel("ADMIN_LOGIN_FAILED"), "Admin hesabına uğursuz giriş cəhdi");
  assert.equal(auditActionLabel("SECURITY_FULL_IP_VIEW"), "Tam IP ünvanlarına baxıldı");
  assert.equal(auditActionLabel("PRODUCT_ACTIVE"), "Məhsul statusu: Aktiv");
  assert.equal(auditActionLabel("ORDER_DELIVERED"), "Sifariş statusu: Çatdırıldı");
  assert.equal(auditActionLabel("ORDER_CANCELLATION_APPROVED"), "Ləğv müraciəti: təsdiqləndi");
  assert.equal(auditActionLabel("SUBSCRIPTION_ADMIN_ACTIVE"), "Abunəlik statusu: Aktiv");
  assert.equal(auditActionLabel("RETURN_ADMIN_REFUNDED"), "Qaytarılma statusu: Geri ödənildi");
  assert.equal(auditActionLabel("SOMETHING_NEW"), "SOMETHING_NEW", "unknown codes are shown as they are");
  assert.equal(auditActionLabel("PRODUCT_WEIRD"), "PRODUCT_WEIRD", "unknown status falls back to the code");
  assert.equal(auditActionLabel(""), "—");
  for (const action of SECURITY_AUDIT_ACTIONS) assert.ok(AUDIT_ACTION_LABELS[action], action);
});

test("labels: /admin/audit-log shows the label (code kept small) and labels the action filter", () => {
  const page = read("app/admin/audit-log/page.tsx");
  assert.match(page, /\{auditActionLabel\(row\.action\)\}\{auditActionLabel\(row\.action\) !== row\.action && <span className="mt-0\.5 block font-mono text-\[11px\] text-fg-muted">\{row\.action\}<\/span>\}/);
  assert.match(page, /<Select name="action" title="Əməl" values=\{distinct\.actions\} selected=\{filters\.action\} labelFor=\{auditActionLabel\} \/>/);
  assert.doesNotMatch(page, /<td className="px-4 py-3\.5">\{row\.action\}<\/td>/);
});

// ---------------------------------------------------------------- admin login audit

test("ADMIN_LOGIN_FAILED is built only for an existing ADMIN account and never contains an e-mail", () => {
  assert.equal(adminLoginFailureRow(null, "admin", "password", "203.0.113.5"), null, "unknown account: nothing stored");
  assert.equal(adminLoginFailureRow({ id: "u1", role: "CUSTOMER" }, "customer", "password", "203.0.113.5"), null);
  assert.equal(adminLoginFailureRow({ id: "u2", role: "VENDOR" }, "vendor", "inactive", null), null);
  const row = adminLoginFailureRow({ id: "a1", role: "ADMIN" }, "customer", "password", "203.0.113.5");
  assert.deepEqual(row, { actorId: "a1", action: "ADMIN_LOGIN_FAILED", entityType: "User", entityId: "a1", metadata: { ip: "203.0.113.5", portal: "customer", reason: "password" } });
  assert.doesNotMatch(JSON.stringify(row), /@|email/i);
});

test("ADMIN_LOGIN carries the session reference (8 chars), the full IP and the method", () => {
  const row = adminLoginRow("a1", "0123456789abcdef-session", "2fa", "203.0.113.5");
  assert.deepEqual(row, { actorId: "a1", action: "ADMIN_LOGIN", entityType: "AuthSession", entityId: "01234567", metadata: { ip: "203.0.113.5", method: "2fa", portal: "admin" } });
});

test("audit writes are fire-and-forget: they never throw, never reject and never make the caller wait", async () => {
  const row: AuditRow = { actorId: "a1", action: "ADMIN_LOGIN", entityType: "AuthSession", entityId: "x", metadata: {} };
  let started = 0;
  const hanging = () => { started++; return new Promise<never>(() => undefined); };
  const t0 = performance.now();
  assert.equal(writeAuditInBackground(row, hanging), undefined);
  assert.ok(performance.now() - t0 < 50, "returns at once even when the database hangs");
  assert.doesNotThrow(() => writeAuditInBackground(row, () => { throw new Error("sync failure"); }));
  assert.doesNotThrow(() => writeAuditInBackground(row, () => Promise.reject(new Error("db down"))));
  writeAuditInBackground(null, hanging);
  assert.equal(started, 1, "null row: no write");
  await new Promise((done) => setTimeout(done, 10)); // let the rejected promise settle: no unhandled rejection
});

test("login routes record admin failures (admin accounts only, background) and successful admin logins", () => {
  for (const [path, tag, portal] of [["app/api/admin/login/route.ts", "admin_login", "admin"], ["app/api/auth/login/route.ts", "customer_login", "customer"], ["app/api/auth/vendor-login/route.ts", "vendor_login", "vendor"]] as const) {
    const source = read(path);
    before(source, `logAuthRejection("${tag}", "inactive");`, `auditAdminLoginFailure(request, user, "${portal}", "inactive");`, path);
    before(source, `logAuthRejection("${tag}", user.passwordAuthEnabled ? "password-mismatch" : "password-disabled");`, `auditAdminLoginFailure(request, user, "${portal}", user.passwordAuthEnabled ? "password" : "password-disabled");`, path);
    assert.doesNotMatch(source, /await auditAdmin/, `${path}: never awaited`);
    assert.doesNotMatch(source, /auditAdminLoginFailure\([^)]*email/, `${path}: no e-mail passed`);
  }
  before(read("app/api/admin/login/route.ts"), "response.cookies.set(session);", 'auditAdminLogin(request, user.id, session.value, "password");', "admin password-only login");
  before(read("app/api/admin/login/2fa/route.ts"), "response.cookies.set(session);", 'auditAdminLogin(request, admin.id, session.value, "2fa");', "admin 2FA login");
  before(read("app/api/admin/2fa/activate/route.ts"), "response.cookies.set(session);", 'auditAdminLogin(request, actor.userId, session.value, "2fa-enroll");', "forced enrollment login");
  const lib = read("lib/admin-login-audit.ts");
  assert.match(lib, /if \(!user \|\| user\.role !== "ADMIN"\) return;/);
  assert.match(lib, /void write\(row\)\.catch\(/);
});

// ---------------------------------------------------------------- retention and full IP

test("raw IPs are kept 30 days (was 7); the masked form stays afterwards", () => {
  assert.equal(RETENTION.rawIpDays, 30);
  assert.match(read("lib/security-monitoring/jobs.ts"), /clears the raw IP of events older than 30 days \(only where the masked form exists\)/);
});

test("shownIp: full IP only in full mode and only while the raw value exists", () => {
  assert.equal(shownIp("203.0.113.5", "203.0.*.*", true), "203.0.113.5");
  assert.equal(shownIp("203.0.113.5", "203.0.*.*", false), "203.0.*.*");
  assert.equal(shownIp(null, "203.0.*.*", true), "203.0.*.*", "after 30 days only the mask exists");
  assert.equal(shownIp("203.0.113.5", null, false), "203.0.*.*", "not-yet-masked row is masked on display");
  assert.equal(shownIp(null, null, true), null);
});

test("full IPs are shown only after the SECURITY_FULL_IP_VIEW audit row was written", () => {
  // SECURITY-CENTER-DESIGN-2: the overview shows one IP (last login, via loginIp); the logins tab is a new reveal page.
  for (const [path, page, output] of [
    ["app/admin/security-center/page.tsx", "summary", "<Ip value={loginIp("],
    ["app/admin/security-center/events/page.tsx", "events", "shownIp(row."],
    ["app/admin/security-center/logins/page.tsx", "logins", "shownIp(row."],
  ] as const) {
    const source = read(path);
    assert.match(source, new RegExp(`const full = [^;]*\\? await recordFullIpView\\(admin\\.id, "${page}"\\) : false;`), path);
    before(source, `recordFullIpView(admin.id, "${page}")`, output, path);
  }
  const data = read("lib/security-center-data.ts");
  assert.match(data, /action: "SECURITY_FULL_IP_VIEW", entityType: "SecurityCenter", entityId: page/);
  assert.match(data, /return true;\n  \} catch \(error\) \{[\s\S]*?return false;/, "a failed audit write keeps the IPs masked");
  // The reveal is a GET form (never prefetched by the router), not a Link. DESIGN-2: the form moved into the shared
  // FullIpToggle (components/security-center-ui.tsx); the overview passes its own action.
  assert.match(read("components/security-center-ui.tsx"), /<form method="get" action=\{action\}><input type="hidden" name="ip" value="full" \/>/);
  assert.match(read("app/admin/security-center/page.tsx"), /<FullIpToggle action="\/admin\/security-center" full=\{full\}\/>/);
});

// ---------------------------------------------------------------- summary helpers

test("portal labels and login methods", () => {
  assert.equal(portalForPath("/api/auth/login"), "Müştəri girişi");
  assert.equal(portalForPath("/api/auth/vendor-login"), "Satıcı girişi");
  assert.equal(portalForPath("/api/admin/login"), "Admin girişi");
  assert.equal(portalForPath("/api/admin/login/2fa"), "Admin 2FA");
  assert.equal(portalForPath("/something"), "/something");
  assert.equal(portalLabel("vendor"), "Satıcı girişi");
  assert.equal(loginMethodLabel("2fa"), "Şifrə + 2FA kodu");
  assert.equal(loginMethodLabel(undefined), "—");
  assert.deepEqual(NOT_FOUND_GROUPS.slice(0, 4).map((item) => item.group), ["notfound.php", "notfound.wp", "notfound.secrets", "notfound.admin-probe"]);
});

test("login IP join: ADMIN_LOGIN audit rows keyed by admin + session reference", () => {
  const map = loginAuditBySession([
    { actorId: "a1", entityId: "01234567", metadata: { ip: "203.0.113.5", method: "password" } },
    { actorId: "a2", entityId: "01234567", metadata: { ip: "198.51.100.9", method: "2fa" } },
    { actorId: null, entityId: "x", metadata: {} },
  ]);
  assert.deepEqual(map.get("a1:01234567"), { ip: "203.0.113.5", method: "password" });
  assert.deepEqual(map.get("a2:01234567"), { ip: "198.51.100.9", method: "2fa" }, "same short reference, different admin");
  assert.equal(map.size, 2);
});

test("IP check light: good / X-Real-IP missing / flag off / headers disagree", () => {
  const headers = (realIp: boolean) => [{ name: "cf-connecting-ip", present: true, values: [] }, { name: "x-real-ip", present: realIp, values: [] }];
  assert.equal(ipCheckLight({ flagEnabled: true, headers: headers(true), ipWithFlagOn: "5.191.*.*", cfRealIpMismatch: false }).tone, "good");
  assert.equal(ipCheckLight({ flagEnabled: true, headers: headers(false), ipWithFlagOn: "5.191.*.*", cfRealIpMismatch: false }).tone, "warn");
  assert.equal(ipCheckLight({ flagEnabled: false, headers: headers(true), ipWithFlagOn: "5.191.*.*", cfRealIpMismatch: false }).tone, "warn");
  assert.equal(ipCheckLight({ flagEnabled: true, headers: headers(true), ipWithFlagOn: null, cfRealIpMismatch: true }).tone, "bad");
  assert.match(ipCheckLight({ flagEnabled: true, headers: headers(true), ipWithFlagOn: "5.191.*.*", cfRealIpMismatch: false }).detail, /5\.191\.\*\.\*/);
});

test("event list filters: only produced event types, bounded page and query", () => {
  assert.deepEqual(PRODUCED_EVENT_TYPES, ["LOGIN_FAILURE", "RATE_LIMIT_VIOLATION", "IP_HEADER_MISMATCH"]);
  assert.deepEqual(parseEventFilters({}), { window: "7d", eventType: "", severity: "", q: "", page: 1, fullIp: false });
  assert.deepEqual(parseEventFilters({ window: "30d", type: "WAF_EVENT", severity: "HIGH", q: "x".repeat(300), page: "99999", ip: "full" }), { window: "30d", eventType: "", severity: "HIGH", q: "x".repeat(100), page: 1, fullIp: true });
  assert.equal(parseEventFilters({ type: "LOGIN_FAILURE", page: "3" }).page, 3);
  assert.equal(EVENTS_PAGE_SIZE, 10, "SECURITY-CENTER-DESIGN-2: compact tab, 10 per page (was 50)");
});

// ---------------------------------------------------------------- page wiring, limits, cleanup

test("summary and event pages: admin + security.view first, read-only bounded queries, no auto-refresh", () => {
  const data = read("lib/security-center-data.ts");
  assert.match(data, /export const SECURITY_PAGE_TIMEOUT_MS = 4_000;/);
  assert.match(data, /return await boundedRead\(prisma, SECURITY_PAGE_TIMEOUT_MS, work\);/);
  assert.doesNotMatch(data, /\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\((?![^)]*SECURITY_FULL_IP_VIEW)/, "only the full-IP audit row is written");
  for (const take of data.matchAll(/take: (\d+)/g)) assert.ok(Number(take[1]) <= 100, `take ${take[1]}`);
  for (const limit of data.matchAll(/LIMIT (\d+)/g)) assert.ok(Number(limit[1]) <= 60, `LIMIT ${limit[1]}`);
  // SECURITY-CENTER-DESIGN-2: the pages stay server pages without timers; the optional auto-refresh lives in the client
  // component components/security-refresh.tsx (off by default, tested in security-center-design-2.test.ts).
  const tabs = ["page.tsx", "events/page.tsx", "logins/page.tsx", "audit/page.tsx", "incidents/page.tsx"].map((name) => `app/admin/security-center/${name}`);
  for (const path of tabs) {
    const source = read(path);
    assert.match(source, /export const dynamic = "force-dynamic";/);
    assert.doesNotMatch(source, /setInterval|"use client"/, path);
  }
  // DESIGN-2: the blocks moved from the summary into their tabs (titles unchanged).
  const all = tabs.map(read).join("\n");
  assert.ok(read(tabs[0]).includes('title="IP yoxlaması"'));
  for (const title of ["Adminlər və iki mərhələli təsdiq", "Son admin girişləri", "Uğursuz girişlər", "Şübhəli fəaliyyət", "Son təhlükəsizlik əməliyyatları"]) {
    assert.ok(all.includes(`<Block title="${title}"`), title);
  }
  for (const link of ["/admin/system", "/admin/security", "/admin/security-center/incidents", "/admin/security-center/events", "/admin/audit-log"]) assert.ok(all.includes(link) || read("lib/security-center-status.ts").includes(link), link);
  // Browser check (390 px): cards shrink (min-w-0) and tables turn into small cards on phones (no sideways scroll).
  const ui = read("components/security-center-ui.tsx");
  assert.match(ui, /<section className=\{`\$\{card\} min-w-0`\} id=\{id\}>/);
  assert.match(ui, /<table className="w-full text-left text-sm max-sm:block sm:min-w-\[480px\]">/);
  assert.match(read("app/admin/security-center/logins/page.tsx"), /<RowTable head=\{\["E-poçt", "2FA", "Kilid", "Bərpa kodları"\]\}/);
});

test("security events are written as UTC wall-clock times (no +4 h shift on a database set to Asia/Baku)", () => {
  const store = read("lib/security-event-store.ts");
  assert.match(store, /\$\{utcTimestamp\(new Date\(input\.event\.occurredAt\)\)\},/);
  assert.match(store, /\$\{input\.event\.ruleId \?\? null\}, \(NOW\(\) AT TIME ZONE 'UTC'\)/);
  assert.doesNotMatch(store, /\$\{new Date\(input\.event\.occurredAt\)\},/);
  // The blocks with wide tables now each have a tab (SECURITY-CENTER-DESIGN-2), full width there; the incidents block
  // became the overview's "needs attention" list and the incidents tab.
  for (const [title, path] of [["Son admin girişləri", "logins"], ["Uğursuz girişlər", "logins"], ["Şübhəli fəaliyyət", "events"], ["Son təhlükəsizlik əməliyyatları", "audit"]]) {
    assert.ok(read(`app/admin/security-center/${path}/page.tsx`).includes(`<Block title="${title}"`), title);
  }
});

test("cleanup: nested old center, IP-controls API, Apache/Cloudflare cards, empty filters and duplicate IP list are gone", () => {
  assert.equal(existsSync(resolve(root, "components/admin-security-center.tsx")), false);
  assert.equal(existsSync(resolve(root, "app/api/admin/security/ip-controls/route.ts")), false);
  const all = [...sourceFiles("app/admin"), ...sourceFiles("components")].map(read).join("\n");
  for (const gone of ["Hazır deyil — firewall", "Apache / ModSecurity", "Tətbiqdə istehsalçı yoxdur", "IP idarəetməsi", "Təkrarlanan IP-lər (7 gün, maskalanıb)"]) assert.ok(!all.includes(gone), gone);
  assert.doesNotMatch(read("app/admin/security-center/events/page.tsx"), /SUSPICIOUS_PATH|ABUSIVE_API|WAF_EVENT/);
  assert.doesNotMatch(read("lib/admin-system-status-cards.ts"), /repeatedIps/);
  assert.doesNotMatch(read("components/admin-system-status.tsx"), /repeatedIps/);
});
