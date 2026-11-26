/**
 * ADMIN-3-TODAY-1, commit 1: day-1 rows in the dashboard's "Diqqət tələb edir" queue (T2 of
 * release-output/admin-3-audit-1-report.md) and the payment state next to the total in "Son sifarişlər".
 * (a) each of the six rows appears only when its count is above 0, with the owner-approved label and its link;
 * (b) the counts are single count reads, started together in the existing Promise.all, with the right filters;
 * (c) "Son sifarişlər" shows the payment label (existing helper) or "Ödəniş qeydi yoxdur."; no revenue figure;
 * (d) no other new visible text; scope = BASE..this commit.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { ADMIN_TODAY_TEXT, attentionItems, bakuDayStartUtc, type AttentionCounts } from "../lib/admin-power-1";
import { ALL_ORDER_STATUSES, loadDashboardActivity, lowStockActiveProductsQuery } from "../lib/admin-dashboard-activity";

const root = process.cwd();
const BASE = "17815d0";
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
// This commit (the queue); scope checks compare BASE with it, not the working tree. Before the commit: working tree.
const TASK = git("log", "--format=%H", "--grep=^ADMIN-3-TODAY-1: dashboard", `${BASE}..HEAD`).trim().split(/\r?\n/).filter(Boolean)[0] ?? null;
const atTask = (path: string) => (TASK ? git("show", `${TASK}:${path}`).replace(/\r\n/g, "\n") : read(path));
const atBase = (path: string) => { try { return git("show", `${BASE}:${path}`).replace(/\r\n/g, "\n"); } catch { return ""; } };

const ZERO: AttentionCounts = { pendingApplications: 0, storesInReview: 0, pendingOrders: 0, openSupport: 0, openReports: null, unverifiedAccounts: 0, ordersToday: 0, returnsWaiting: 0, supportInProgress: 0, failedEmails: 0, lowStockProducts: 0, sellersWithoutStore: 0 };
const ROWS = [
  ["returnsWaiting", "Gözləyən qaytarmalar", "/admin/returns"],
  ["failedEmails", "Göndərilməyən e-poçtlar", "/admin/email"],
  ["ordersToday", "Bugünkü sifarişlər", "/admin/orders"],
  ["lowStockProducts", "Azalan stoklu məhsullar", "/admin/products"],
  ["supportInProgress", "İşlənən müraciətlər", "/admin/support?status=IN_PROGRESS"],
  ["sellersWithoutStore", "Mağazası olmayan satıcılar", "/admin/vendors"],
] as const;

test("(a) each new row appears only when its count is above 0, with the approved label and its link", () => {
  assert.deepEqual(attentionItems(ZERO, "/admin/orders?status=pending"), [], "all zero: no row (the card is hidden)");
  for (const [key, label, href] of ROWS) {
    assert.equal(ADMIN_TODAY_TEXT[key], label, `${key}: owner-approved text`);
    const items = attentionItems({ ...ZERO, [key]: 3 }, "/admin/orders?status=pending");
    assert.deepEqual(items.map((item) => [item.key, item.label, item.count, item.href]), [[key, label, 3, href]], key);
  }
  // Existing rows unchanged and in the same relative order; the new ones slot in next to their topic.
  const all = attentionItems({ pendingApplications: 1, storesInReview: 1, pendingOrders: 1, openSupport: 1, openReports: 1, unverifiedAccounts: 1, ordersToday: 1, returnsWaiting: 1, supportInProgress: 1, failedEmails: 1, lowStockProducts: 1, sellersWithoutStore: 1 }, "/p");
  assert.deepEqual(all.map((item) => item.key), ["pendingApplications", "storesInReview", "pendingOrders", "ordersToday", "returnsWaiting", "openSupport", "supportInProgress", "openReports", "unverifiedAccounts", "failedEmails", "lowStockProducts", "sellersWithoutStore"]);
});

test("(b) the six counts: right filters, started together with the existing reads (one Promise.all)", async () => {
  let inFlight = 0, maxInFlight = 0;
  const calls: Record<string, unknown> = {};
  const slow = <T>(name: string, args: unknown, value: T) => { calls[name] = args; inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); return new Promise<T>((done) => setTimeout(() => { inFlight -= 1; done(value); }, 5)); };
  const db = {
    $queryRaw: (sql: { sql: string }) => sql.sql.includes('FROM "Product"') ? slow("lowStock", sql.sql, [{ n: 7 }]) : slow(sql.sql.includes('FROM "Order"') ? "chartOrders" : "chartStores", null, []),
    vendorApplication: { count: (args: unknown) => slow("applications", args, 0) },
    supportTicket: { count: (args: { where: { status: string } }) => slow(`support ${args.where.status}`, args, args.where.status === "IN_PROGRESS" ? 4 : 0) },
    conversationReport: { count: (args: unknown) => slow("reports", args, 0) },
    order: { count: (args: unknown) => slow("ordersToday", args, 2) },
    returnRequest: { count: (args: unknown) => slow("returns", args, 1) },
    emailOutbox: { count: (args: unknown) => slow("emails", args, 3) },
    vendorProfile: { count: (args: unknown) => slow("sellers", args, 5) },
  };
  const now = new Date("2026-11-25T21:30:00Z"); // 01:30 on 26 November in Baku
  const result = await loadDashboardActivity(db as never, now, true);
  assert.equal(maxInFlight, 11, "all 11 reads in flight together");
  assert.deepEqual([result.ordersToday, result.returnsWaiting, result.supportInProgress, result.failedEmails, result.lowStockProducts, result.sellersWithoutStore], [2, 1, 4, 3, 7, 5]);
  // Orders since 00:00 Baku today; every status listed so Order(status, createdAt) serves it (like the chart query).
  assert.deepEqual(calls.ordersToday, { where: { status: { in: ALL_ORDER_STATUSES }, createdAt: { gte: bakuDayStartUtc("2026-11-26") } } });
  assert.equal(bakuDayStartUtc("2026-11-26").toISOString(), "2026-11-25T20:00:00.000Z");
  assert.deepEqual(calls.returns, { where: { status: "REQUESTED" } });
  assert.deepEqual(calls["support IN_PROGRESS"], { where: { status: "IN_PROGRESS" } });
  assert.deepEqual(calls.emails, { where: { status: "FAILED" } });
  assert.deepEqual(calls.sellers, { where: { stores: { none: {} }, user: { role: "VENDOR", isActive: true } } });
  // Low stock: the seller dashboard's rule (0 < available <= the row's own threshold), active products, counted once.
  const sql = lowStockActiveProductsQuery().sql;
  assert.match(sql, /COUNT\(DISTINCT p\."id"\)/);
  assert.match(sql, /p\."status" = 'ACTIVE'::"ProductStatus"/);
  assert.match(sql, /i\."quantity" - i\."reserved" > 0 AND i\."quantity" - i\."reserved" <= i\."lowStockThreshold"/);
  assert.match(read("app/vendor/[storeId]/page.tsx"), /i\."quantity" - i\."reserved" > 0 AND i\."quantity" - i\."reserved" <= i\."lowStockThreshold"/, "same rule as the seller dashboard");
  // Counts only (no row lists) in the loader.
  assert.doesNotMatch(read("lib/admin-dashboard-activity.ts"), /findMany|findFirst/);
  // Indexes that serve the filtered counts (prisma/schema.prisma, no migration).
  const schema = read("prisma/schema.prisma");
  const model = (name: string) => schema.slice(schema.indexOf(`model ${name} {`), schema.indexOf("}", schema.indexOf(`model ${name} {`)));
  assert.match(model("Order"), /@@index\(\[status, createdAt\]\)/);
  assert.match(model("SupportTicket"), /@@index\(\[status, createdAt\]\)/);
  assert.match(model("EmailOutbox"), /@@index\(\[status, availableAt\]\)/);
  assert.match(model("Inventory"), /@@index\(\[productId\]\)/);
  assert.match(model("Store"), /@@index\(\[vendorId, cityId\]\)/);
});

test("(c) Son sifarişlər: payment state next to the total (existing label helper and wording), no revenue figure", () => {
  const page = atTask("app/admin/page.tsx");
  assert.match(page, /payments: \{ select: \{ status: true \}, orderBy: \{ createdAt: "desc" \}, take: 1 \}/, "only the latest payment row per order");
  assert.ok(page.includes('{order.payments[0] ? adminStatusLabel("payment", order.payments[0].status) : "Ödəniş qeydi yoxdur."}'));
  assert.ok(atBase("app/admin/_sections/order-detail.tsx").includes("Ödəniş qeydi yoxdur."), "existing wording");
  assert.doesNotMatch(page, /_sum|aggregate\(|groupBy\(\{ by: \["status"\], _sum/, "no revenue sum");
  // The six counts reach the queue.
  for (const [key] of ROWS) assert.ok(page.includes(`${key}: activity.${key}`), key);
});

test("(d) no other new visible text; scope of this commit", () => {
  const AZ = /[əğıöüşçƏĞİÖÜŞÇ]/;
  const fragments = (source: string) => new Set(source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*\*|\{\/\*)/.test(line)).join("\n").split(/["'`<>{}]|\$\{/).map((part) => part.trim()).filter((part) => AZ.test(part)));
  const approved = new Set<string>(Object.values(ADMIN_TODAY_TEXT));
  const existing = new Set([...fragments(atBase("app/admin/_sections/order-detail.tsx"))]);
  for (const path of ["lib/admin-power-1.ts", "lib/admin-dashboard-activity.ts", "app/admin/page.tsx"]) {
    const before = fragments(atBase(path));
    const added = [...fragments(atTask(path))].filter((part) => !before.has(part) && !approved.has(part) && !existing.has(part));
    assert.deepEqual(added, [], `${path}: new Azerbaijani text`);
  }
  if (TASK) {
    const files = git("diff", "--name-only", BASE, TASK).split(/\r?\n/).filter(Boolean).sort();
    assert.deepEqual(files, ["app/admin/page.tsx", "lib/admin-dashboard-activity.ts", "lib/admin-power-1.ts", "scripts/admin-power-1.test.ts", "scripts/admin-today-1.test.ts"]);
  }
  const untouched = ["prisma", "package.json", "package-lock.json", "app/(customer)/terms", "app/(customer)/privacy", "app/(customer)/seller-terms", "lib/legal-versions.ts"];
  assert.equal((TASK ? git("diff", "--name-only", BASE, TASK, "--", ...untouched) : git("diff", "--name-only", BASE, "--", ...untouched)).trim(), "");
});
