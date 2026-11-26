/**
 * ADMIN-POWER-1: dashboard chart + queue, global admin search, admin list CSV exports, admin-only fonts, detail headers.
 * Unit checks (no database). The 5433 checks are in scripts/admin-power-1.integration.test.ts and the report.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ADMIN_BACK_LINKS, ADMIN_LIST_EXPORT_MAX_ROWS, ADMIN_POWER_1_REUSED, ADMIN_POWER_1_TEXT, ADMIN_SEARCH_GROUP_LIMIT, attentionItems,
  bakuDateKey, bakuDayStartUtc, buildAdminListCsv, capRows, CSV_BOM, fillDailyActivity, lastBakuDays, parseAdminSearchTerm,
} from "../lib/admin-power-1";
import { ALL_ORDER_STATUSES, dailyOrdersQuery, dailyStoresQuery, loadDashboardActivity } from "../lib/admin-dashboard-activity";
import { adminGlobalSearch } from "../lib/admin-global-search";
import { ADMIN_LIST_EXPORT_HEADERS, adminListExportAuditData, buildAdminListExport } from "../lib/admin-list-export";
import { allowAdminRequest } from "../lib/admin-request-limit";
import { AdminActivityChart } from "../components/admin-activity-chart";
import { AdminAttentionQueue } from "../components/admin-attention-queue";
import { ADMIN_POWER_1_API_ROUTES, isAllowedAdminChange } from "./admin-power-1-scope";

(globalThis as { React?: typeof React }).React = React;
const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const BASE = "ac3823d";
// ADMIN-DESIGN-2: the scope checks look at this task's own commit (later approved admin tasks change admin files again).
const TASK = "9ea73f5";
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const baseFile = (path: string) => { try { return git("show", `${BASE}:${path}`); } catch { return ""; } };
const html = (element: React.ReactElement) => renderToStaticMarkup(element);

// -----------------------------------------------------------------------------------------------------------------
// Dashboard: Baku days, bounded parallel counts, chart, queue
// -----------------------------------------------------------------------------------------------------------------

test("Baku days: day keys, day starts (UTC+4), 30 days ending today, zero-filled real counts", () => {
  assert.equal(bakuDateKey(new Date("2026-11-24T19:59:59Z")), "2026-11-24");
  assert.equal(bakuDateKey(new Date("2026-11-24T20:00:00Z")), "2026-11-25", "midnight in Baku is 20:00 UTC");
  assert.equal(bakuDayStartUtc("2026-11-25").toISOString(), "2026-11-24T20:00:00.000Z");
  const days = lastBakuDays(new Date("2026-11-25T03:00:00Z"));
  assert.equal(days.length, 30);
  assert.equal(days[29], "2026-11-25");
  assert.equal(days[0], "2026-10-27");
  assert.equal(new Set(days).size, 30);
  const filled = fillDailyActivity(["2026-11-24", "2026-11-25"], [{ day: "2026-11-25", n: BigInt(3) }, { day: "2026-01-01", n: 9 }], [{ day: "2026-11-24", n: 1 }]);
  assert.deepEqual(filled, [{ day: "2026-11-24", orders: 0, stores: 1 }, { day: "2026-11-25", orders: 3, stores: 0 }], "missing days are 0; days outside the window ignored");
});

test("chart queries: GROUP BY Baku day, bounded by date, every order status (uses Order(status, createdAt)), UTC-safe bounds", () => {
  const start = new Date("2026-10-26T20:00:00Z");
  const orders = dailyOrdersQuery(start), stores = dailyStoresQuery(start);
  for (const sql of [orders, stores]) {
    assert.match(sql.sql, /AT TIME ZONE 'UTC'\) AT TIME ZONE 'Asia\/Baku'\)::date/);
    assert.match(sql.sql, /"createdAt" >= \(\?::timestamptz AT TIME ZONE 'UTC'\)/);
    assert.match(sql.sql, /GROUP BY 1/);
    assert.match(sql.sql, /COUNT\(\*\)::int/);
  }
  assert.match(orders.sql, /"status" = ANY\(\?::"OrderStatus"\[\]\)/);
  assert.deepEqual(orders.values[0], ALL_ORDER_STATUSES);
  assert.deepEqual([...ALL_ORDER_STATUSES].sort(), read("prisma/schema.prisma").match(/enum OrderStatus \{([^}]*)\}/)![1].split(/\s+/).filter(Boolean).sort());
});

test("dashboard reads: counts only, started together (parallel), reports via the messaging service only when messaging is on", async () => {
  let inFlight = 0, maxInFlight = 0;
  const calls: string[] = [];
  const slow = <T>(name: string, value: T) => { calls.push(name); inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); return new Promise<T>((resolve) => setTimeout(() => { inFlight -= 1; resolve(value); }, 5)); };
  const db = {
    $queryRaw: (sql: { sql: string }) => sql.sql.includes('FROM "Product"') ? slow("low stock", [{ n: 0 }]) : slow(sql.sql.includes('FROM "Order"') ? "orders" : "stores", sql.sql.includes('FROM "Order"') ? [{ day: "2026-11-25", n: 4 }] : []),
    vendorApplication: { count: (args: unknown) => slow(`applications ${JSON.stringify(args)}`, 5) },
    supportTicket: { count: (args: unknown) => slow(`support ${JSON.stringify(args)}`, 2) },
    conversationReport: { count: (args: unknown) => slow(`reports ${JSON.stringify(args)}`, 1) },
    // ADMIN-3-TODAY-1: the six day-1 counts run in the same Promise.all (zeros here; scripts/admin-today-1.test.ts checks them).
    order: { count: () => slow("orders today", 0) },
    returnRequest: { count: () => slow("returns", 0) },
    emailOutbox: { count: () => slow("emails", 0) },
    vendorProfile: { count: () => slow("sellers", 0) },
  };
  const on = await loadDashboardActivity(db as never, new Date("2026-11-25T03:00:00Z"), true);
  assert.equal(maxInFlight, 11, "all reads (five + the six ADMIN-3-TODAY-1 counts) run at the same time");
  assert.deepEqual(calls.filter((call) => !["orders today", "returns", "emails", "sellers", "low stock", 'support {"where":{"status":"IN_PROGRESS"}}'].includes(call)).sort(), ['applications {"where":{"status":"PENDING"}}', "orders", 'reports {"where":{"status":"OPEN"}}', "stores", 'support {"where":{"status":"OPEN"}}']);
  assert.equal(on.days.length, 30);
  assert.equal(on.days[29].orders, 4);
  assert.deepEqual([on.pendingApplications, on.openSupport, on.openReports], [5, 2, 1]);
  calls.length = 0;
  const off = await loadDashboardActivity(db as never, new Date("2026-11-25T03:00:00Z"), false);
  assert.equal(off.openReports, null);
  assert.ok(!calls.some((call) => call.startsWith("reports")), "no report count while messaging is off");
  const source = read("lib/admin-dashboard-activity.ts");
  assert.doesNotMatch(source, /findMany|\.conversationReport\./, "counts only; reports through lib/messaging-admin.ts");
  // The dashboard starts the new reads before its own Promise.all and awaits them together.
  // ADMIN-3-TODAY-1: read at this task's commit (TASK); later approved dashboard work (e.g. the payment state of the
  // recent orders) changes the working tree.
  const page = git("show", `${TASK}:app/admin/page.tsx`);
  assert.ok(page.indexOf("const activityPromise") < page.indexOf("await Promise.all(["), "started before the existing counts");
  assert.match(page, /await Promise\.all\(\[messagingPromise, activityPromise, unverifiedPromise\]\)/);
  // The 11 KPI cards and their queries are unchanged.
  const block = (source: string) => source.slice(source.indexOf("await Promise.all(["), source.indexOf("] as const;"));
  assert.equal(block(page.replace(/\r\n/g, "\n")), block(baseFile("app/admin/page.tsx").replace(/\r\n/g, "\n")));
});

test("queue: real counts, links that show the same rows, items at 0 hidden, card hidden when all are 0", () => {
  const counts = { pendingApplications: 3, storesInReview: 0, pendingOrders: 4, openSupport: 2, openReports: 0, unverifiedAccounts: 1, ordersToday: 0, returnsWaiting: 0, supportInProgress: 0, failedEmails: 0, lowStockProducts: 0, sellersWithoutStore: 0 };
  const items = attentionItems(counts, "/admin/orders?status=pending");
  assert.deepEqual(items.map((item) => [item.label, item.count, item.href]), [
    ["Satıcı müraciətləri", 3, "/admin/seller-applications"],
    ["Gözləyən sifarişlər", 4, "/admin/orders?status=pending"],
    ["Dəstək müraciətləri", 2, "/admin/support?status=OPEN"],
    ["E-poçt təsdiqi gözləyənlər", 1, "/admin/verification"],
  ]);
  assert.ok(!attentionItems({ ...counts, openReports: null }, "/x").some((item) => item.key === "openReports"), "messaging off: no reports item");
  assert.equal(html(createElement(AdminAttentionQueue, { items: attentionItems({ pendingApplications: 0, storesInReview: 0, pendingOrders: 0, openSupport: 0, openReports: 0, unverifiedAccounts: 0, ordersToday: 0, returnsWaiting: 0, supportInProgress: 0, failedEmails: 0, lowStockProducts: 0, sellersWithoutStore: 0 }, "/x") })), "");
  const out = html(createElement(AdminAttentionQueue, { items }));
  assert.match(out, />Diqqət tələb edir</);
  assert.match(out, /href="\/admin\/seller-applications"/);
});

test("chart: SVG with title and desc, hover titles per day, a table with the same numbers for screen readers", () => {
  const days = lastBakuDays(new Date("2026-11-25T03:00:00Z")).map((day, index) => ({ day, orders: index === 29 ? 7 : 0, stores: index === 0 ? 2 : 0 }));
  const out = html(createElement(AdminActivityChart, { days }));
  assert.match(out, /<svg[^>]*role="img"[^>]*aria-labelledby="admin-activity-svg-title admin-activity-svg-desc"/);
  assert.match(out, new RegExp(`<title id="admin-activity-svg-title">${ADMIN_POWER_1_TEXT.chartSvgTitle}</title>`));
  assert.match(out, new RegExp(`<desc id="admin-activity-svg-desc">${ADMIN_POWER_1_TEXT.chartSvgDesc}</desc>`));
  assert.match(out, /<title>25\.11 · Sifarişlər: 7<\/title>/);
  assert.match(out, /<table class="sr-only"><caption>Son 30 gün<\/caption>/);
  assert.equal((out.match(/<tr><th scope="row">/g) ?? []).length, 30);
  assert.match(out, /<th scope="row">25\.11<\/th><td>7<\/td><td>0<\/td>/);
  assert.doesNotMatch(out, /AZN|₼|gəlir|ödənildi/i, "no money or payment claims in the chart");
});

// -----------------------------------------------------------------------------------------------------------------
// Global admin search
// -----------------------------------------------------------------------------------------------------------------

test("search term: 2-120 characters, spaces collapsed, LIKE wildcards escaped, order numbers only for order-like terms", () => {
  assert.deepEqual(parseAdminSearchTerm("a"), { ok: false, reason: "short" });
  assert.deepEqual(parseAdminSearchTerm("   "), { ok: false, reason: "short" });
  assert.deepEqual(parseAdminSearchTerm(null), { ok: false, reason: "short" });
  assert.deepEqual(parseAdminSearchTerm("x".repeat(121)), { ok: false, reason: "long" });
  const wild = parseAdminSearchTerm("50%_off\\");
  assert.ok(wild.ok);
  assert.equal(wild.like, "50\\%\\_off\\\\");
  assert.equal(wild.orderFragment, null);
  const order = parseAdminSearchTerm(" #AB12CD34 ");
  assert.ok(order.ok);
  assert.equal(order.orderFragment, "ab12cd34");
  const words = parseAdminSearchTerm("Moda   Evi");
  assert.ok(words.ok);
  assert.equal(words.term, "Moda Evi");
  assert.equal(words.orderFragment, null);
});

test("search service: 5 per group, escaped term, order ids only for order-like terms, no sensitive fields returned", async () => {
  const seen: Record<string, { where: unknown; take: number; select: unknown }> = {};
  const model = (name: string, rows: unknown[]) => ({ findMany: async (args: { where: unknown; take: number; select: unknown }) => { seen[name] = args; return rows; } });
  const db = {
    store: model("store", [{ id: "s1", name: "Moda Evi", status: "ACTIVE", city: { name: "Bakı" } }]),
    product: model("product", [{ id: "p1", name: "Köynək", status: "DRAFT", store: { name: "Moda Evi" } }]),
    order: model("order", []),
    user: model("user", [
      { id: "u1", email: "a@x.invalid", role: "CUSTOMER", customerProfile: { firstName: "Leyla", lastName: "H" }, vendorProfile: null },
      { id: "u2", email: "b@x.invalid", role: "VENDOR", customerProfile: null, vendorProfile: { id: "v2", displayName: "Moda Evi" } },
    ]),
  };
  const term = parseAdminSearchTerm("mo%");
  assert.ok(term.ok);
  const result = await adminGlobalSearch(db as never, term);
  for (const name of ["store", "product", "user"]) assert.equal(seen[name].take, ADMIN_SEARCH_GROUP_LIMIT, name);
  assert.equal(seen.order, undefined, "no order scan for an ordinary word");
  assert.match(JSON.stringify(seen.store.where), /"contains":"mo\\\\%"/);
  assert.match(JSON.stringify(seen.user.where), /"role":\{"in":\["CUSTOMER","VENDOR"\]\}/);
  const selects = JSON.stringify(Object.values(seen).map((call) => call.select));
  assert.doesNotMatch(selects, /passwordHash|token|voen|phone|secret|address/i, "only display fields are selected");
  assert.deepEqual(result.stores, [{ id: "s1", title: "Moda Evi", detail: "Bakı · Aktiv", href: "/admin/stores/s1" }]);
  assert.deepEqual(result.users.map((hit) => hit.href), ["/admin/customers/u1", "/admin/vendors/v2"]);
  assert.match(result.users[0].detail, /· Müştəri$/);
  const orderTerm = parseAdminSearchTerm("#ab12cd34");
  assert.ok(orderTerm.ok);
  await adminGlobalSearch(db as never, orderTerm);
  const orderCall = seen.order as { where: unknown; take: number } | undefined;
  assert.deepEqual(orderCall?.where, { id: { contains: "ab12cd34" } });
  assert.equal(orderCall?.take, ADMIN_SEARCH_GROUP_LIMIT);
});

test("search route: ADMIN only first, rate limited, 422 under 2 characters, private no-store, generic error", () => {
  const route = read("app/api/admin/search/route.ts");
  const body = route.slice(route.indexOf("export async function GET"));
  assert.match(body, /^export async function GET\(request: NextRequest\) \{\n  const admin = await requireRole\("ADMIN"\);\n  if \(!admin\) return NextResponse\.json\(\{ error: "İcazə yoxdur" \}, \{ status: 403/);
  assert.match(body, /if \(!allowAdminRequest\("admin-search", admin\.id, request\.headers, ADMIN_SEARCH_RATE_LIMIT\)\) return rateLimitedResponse\(60\);/);
  assert.match(body, /status: 422/);
  assert.match(route, /"Cache-Control": "private, no-store"/);
  assert.match(body, /\} catch \(error\) \{\n\s+console\.error\("\[admin-search\]"[^\n]*\n\s+return NextResponse\.json\(\{ error: ADMIN_POWER_1_TEXT\.searchError \}, \{ status: 500/, "the browser gets the generic text, never the database error");
  assert.ok(body.indexOf("requireRole") < body.indexOf("allowAdminRequest") && body.indexOf("allowAdminRequest") < body.indexOf("adminGlobalSearch("));
});

test("admin request budget: per admin and per trusted IP, in memory (no database)", () => {
  const counts = new Map<string, number>();
  const consume = (key: string, limit: number) => { const n = (counts.get(key) ?? 0) + 1; counts.set(key, n); return n <= limit; };
  const headers = new Headers({ "cf-connecting-ip": "203.0.113.7" });
  const previous = process.env.BAGATI_TRUST_CLOUDFLARE_IP;
  process.env.BAGATI_TRUST_CLOUDFLARE_IP = "true";
  try {
    assert.equal(allowAdminRequest("admin-search", "a1", headers, { limit: 2, windowMs: 60_000 }, consume), true);
    assert.equal(allowAdminRequest("admin-search", "a1", headers, { limit: 2, windowMs: 60_000 }, consume), true);
    assert.equal(allowAdminRequest("admin-search", "a1", headers, { limit: 2, windowMs: 60_000 }, consume), false, "third call in the window is refused");
    assert.ok(counts.has("admin-search:ip:203.0.113.7"));
  } finally {
    if (previous === undefined) delete process.env.BAGATI_TRUST_CLOUDFLARE_IP; else process.env.BAGATI_TRUST_CLOUDFLARE_IP = previous;
  }
  assert.doesNotMatch(read("lib/admin-request-limit.ts"), /prisma|consumeAuthRateLimit\b/);
});

// -----------------------------------------------------------------------------------------------------------------
// CSV exports
// -----------------------------------------------------------------------------------------------------------------

test("CSV: BOM, CRLF, formula-safe text cells (= + - @ tab CR), quotes doubled, cap 5000", () => {
  const csv = buildAdminListCsv(["a", "b"], [["=1+1", "+90"], ["-5", "@SUM(A1)"], ["\tx", "\rq"], [" =x", 'He said "hi"'], [42, null]]);
  assert.ok(csv.startsWith(CSV_BOM));
  const lines = csv.slice(1).split("\r\n");
  assert.deepEqual(lines.slice(0, 6), ['"a","b"', `"'=1+1","'+90"`, `"'-5","'@SUM(A1)"`, `"'\tx","'\rq"`, `"' =x","He said ""hi"""`, "42,"]);
  assert.equal(ADMIN_LIST_EXPORT_MAX_ROWS, 5000);
  assert.deepEqual(capRows([1, 2, 3], 2), { rows: [1, 2], truncated: true });
  assert.deepEqual(capRows([1, 2], 2), { rows: [1, 2], truncated: false });
  for (const header of Object.values(ADMIN_LIST_EXPORT_HEADERS)) assert.doesNotMatch(header.join(","), /password|token|hash|secret|(^|,)voen(,|$)|address|note/i);
  assert.ok(ADMIN_LIST_EXPORT_HEADERS["seller-applications"].includes("voen_masked"));
});

test("export service: the list's own filter, at most 5001 rows read, VÖEN masked, audit row without the search text", async () => {
  const calls: Record<string, { where: unknown; take: number; select: Record<string, unknown> }> = {};
  const rows = Array.from({ length: ADMIN_LIST_EXPORT_MAX_ROWS + 1 }, (_, i) => ({ createdAt: new Date("2026-11-20T08:00:00Z"), displayName: `=Ad ${i}`, sellerType: "INDIVIDUAL_ENTREPRENEUR", voenNormalized: "1234567891", status: "PENDING", source: "SELF", user: { email: `u${i}@x.invalid` } }));
  const db = { vendorApplication: { findMany: async (args: never) => { calls.app = args; return rows; } } };
  const result = await buildAdminListExport(db as never, "seller-applications", { status: "PENDING", q: "Leyla", page: "3" });
  assert.equal(calls.app.take, ADMIN_LIST_EXPORT_MAX_ROWS + 1);
  assert.equal(result.rowCount, ADMIN_LIST_EXPORT_MAX_ROWS);
  assert.equal(result.truncated, true);
  assert.doesNotMatch(result.csv, /1234567891/, "full VÖEN never exported");
  assert.match(result.csv, /"'=Ad 0"/, "formula-safe");
  assert.match(JSON.stringify(calls.app.where), /"status":"PENDING"/);
  assert.match(JSON.stringify(calls.app.where), /Leyla/);
  assert.deepEqual(result.filterKeys, ["status"]);
  const audit = adminListExportAuditData("admin-1", "seller-applications", result);
  assert.equal(audit.action, "ADMIN_LIST_EXPORT");
  assert.doesNotMatch(JSON.stringify(audit), /Leyla|@x\.invalid/, "no search text or personal data in the audit row");
  assert.deepEqual(audit.metadata, { list: "seller-applications", filterKeys: ["status"], searched: true, rowCount: 5000, truncated: true, maxRows: 5000 });
  // Each list reads with the same where builder as its page.
  const lib = read("lib/admin-list-export.ts");
  for (const builder of ["storesListWhere(sp, q)", "ordersListWhere(sp, q)", "customersListWhere(sp, q)", "sellerApplicationListWhere(filters)"]) assert.ok(lib.includes(builder), builder);
  for (const [page, builder] of [["app/admin/_sections/stores.tsx", "storesListWhere(sp,q)"], ["app/admin/_sections/orders.tsx", "ordersListWhere(sp,q)"], ["app/admin/_sections/customers.tsx", "customersListWhere(sp,q)"]]) assert.ok(read(page).includes(builder), page);
  assert.match(read("lib/seller-application-service.ts"), /const where = sellerApplicationListWhere\(filters\);/);
  assert.doesNotMatch(lib, /passwordHash|resetToken|codeHash|applicantNote|adminNote|addressSnapshot|voen: true/);
});

test("export route: ADMIN only first, known lists only, rate limited, bounded service, audit row, attachment never cached", () => {
  const route = read("app/api/admin/list-export/[list]/route.ts");
  const body = route.slice(route.indexOf("export async function GET"));
  assert.match(body, /\{\n  const admin = await requireRole\("ADMIN"\);\n  if \(!admin\) return NextResponse\.json\(\{ error: "İcazə yoxdur" \}, \{ status: 403/);
  assert.match(body, /if \(!\(ADMIN_LIST_EXPORTS as readonly string\[\]\)\.includes\(list\)\) return NextResponse\.json\([^)]*\{ status: 404/);
  assert.match(body, /allowAdminRequest\("admin-list-export", admin\.id, request\.headers, ADMIN_LIST_EXPORT_RATE_LIMIT\)/);
  assert.match(body, /await prisma\.auditLog\.create\(\{ data: adminListExportAuditData\(/);
  assert.match(body, /"Content-Disposition": `attachment;/);
  assert.match(route, /"Cache-Control": "private, no-store"/);
  assert.equal((body.match(/prisma\.\w+\.(create|update|upsert|delete)/g) ?? []).length, 1, "the audit row is the only write");
  assert.match(read("lib/audit-action-labels.ts"), /ADMIN_LIST_EXPORT: "Admin siyahısı ixrac edildi"/);
  // C1: the products list keeps its existing export.
  assert.equal(git("diff", "--name-only", BASE, TASK, "--", "app/api/admin/products").trim(), "");
});

// -----------------------------------------------------------------------------------------------------------------
// Fonts, scope, texts, money, packages
// -----------------------------------------------------------------------------------------------------------------

test("fonts: admin shell only (own .bagati-admin scope), never the public theme; /admin/login and the noindex layout untouched", () => {
  assert.match(read("components/admin-shell.tsx"), /<div className="bagati-admin min-h-screen[^"]*">\n\s*<AdminFontVariables \/>/);
  assert.match(read("components/admin-theme.tsx"), /<style href="bagati-admin-fonts" precedence="default">/);
  const css = read("app/globals.css");
  assert.match(css, /\.bagati-admin \{[^}]*font-family: var\(--bagati-font-sans\);/);
  assert.doesNotMatch(css.slice(css.indexOf("body:has(> .bagati-public),"), css.indexOf("/* Seller panel (SELLER-DESIGN-1)")), /bagati-admin/, "public scope unchanged");
  assert.equal(git("diff", "--name-only", BASE, "--", "app/admin/login", "app/admin/layout.tsx", "middleware.ts", "app/robots.ts", "components/public-theme.tsx", "components/vendor-theme.tsx").trim(), "");
});

test("scope: only listed admin files and the two new admin routes; no packages, no migration, no Prisma change, legal untouched", () => {
  const changed = git("diff", "--name-only", BASE, TASK, "--", "app/admin", "app/api/admin", "components").split(/\r?\n/).filter((path) => /^(app\/admin\/|app\/api\/admin\/|components\/admin)/.test(path));
  assert.deepEqual(changed.filter((path) => !isAllowedAdminChange(path)), []);
  assert.deepEqual(changed.filter((path) => path.startsWith("app/api/admin/")).sort(), [...ADMIN_POWER_1_API_ROUTES].sort());
  // MULTI-PROCESS-1: checked on the task commit (BASE..TASK), not the working tree: later tasks may change package.json.
  assert.equal(git("diff", "--name-only", BASE, TASK, "--", "package.json", "package-lock.json", "prisma", "lib/legal", "lib/auth.ts", "lib/admin-2fa.ts", "lib/auth-rate-limit.ts", "lib/order-fulfillment.ts", "app/(customer)/terms", "app/(customer)/privacy", "app/(customer)/seller-terms").trim(), "");
});

test("texts: every reused text exists in main at the cited file; back links and new texts as approved", () => {
  for (const [text, file] of Object.entries(ADMIN_POWER_1_REUSED)) assert.ok(baseFile(file).includes(text), `${text} in ${file}`);
  assert.deepEqual(Object.values(ADMIN_BACK_LINKS).map((link) => link.label), ["← Mağazalar", "← Sifarişlər", "← Müştərilər", "← Satıcılar", "← Satıcı müraciətləri"]);
  assert.equal(ADMIN_POWER_1_TEXT.exportCap, "Ən çox 5000 sətir.");
  assert.equal(ADMIN_POWER_1_TEXT.searchMin, "Ən azı 2 simvol yazın.");
});

test("money: the touched admin pages show 42.90 ₼ (lib/price.ts); amounts unchanged", () => {
  for (const path of ["app/admin/page.tsx", "app/admin/_sections/orders.tsx", "app/admin/_sections/products.tsx", "app/admin/_sections/order-detail.tsx", "app/admin/_sections/store-detail.tsx"]) {
    const source = read(path);
    assert.doesNotMatch(source, /formatMoney\(/, path);
    assert.match(source, /formatPrice\(/, path);
  }
});
