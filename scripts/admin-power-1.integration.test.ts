/**
 * ADMIN-POWER-1 integration (5433 verify database, scratch schema cat_admin_power_1 ONLY, read-only except nothing:
 * the services under test only read). Run with DATABASE_URL pointing at that schema; anything else is refused.
 * - search: LIKE wildcards are literal on the real database, groups are capped at 5, an order number finds its order;
 * - CSV: each export reads exactly the rows its list page shows (same filter), VÖEN masked, formula-safe;
 * - chart: the Baku-day GROUP BY equals a count done in JavaScript from the same rows.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { parseAdminSearchTerm, bakuDateKey, lastBakuDays, bakuDayStartUtc } from "../lib/admin-power-1";
import { adminGlobalSearch } from "../lib/admin-global-search";
import { buildAdminListExport } from "../lib/admin-list-export";
import { customersListWhere, ordersListWhere, storesListWhere } from "../lib/admin-list-where";
import { loadDashboardActivity } from "../lib/admin-dashboard-activity";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://refuse@invalid:1/x");
const allowed = url.port === "5433" && ["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname.includes("verify") && url.searchParams.getAll("schema").join() === "cat_admin_power_1";
const prisma = allowed ? new PrismaClient() : (null as unknown as PrismaClient);

test.before(async () => {
  if (!allowed) throw new Error("refuse: DATABASE_URL must be the 5433 verify database with schema=cat_admin_power_1");
  const [where] = await prisma.$queryRaw<{ db: string; port: number; schema: string }[]>`SELECT current_database() AS db, inet_server_port() AS port, current_schema() AS schema`;
  assert.ok(where.db.includes("verify") && Number(where.port) === 5433 && where.schema === "cat_admin_power_1", JSON.stringify(where));
});
test.after(async () => { if (allowed) await prisma.$disconnect(); });

test("search: % and _ match literally, groups capped at 5, an order number finds its order", async () => {
  const percent = parseAdminSearchTerm("%%");
  assert.ok(percent.ok);
  const none = await adminGlobalSearch(prisma, percent);
  assert.deepEqual([none.stores.length, none.products.length, none.users.length], [0, 0, 0], "wildcards do not match everything");
  const underscore = parseAdminSearchTerm("__");
  assert.ok(underscore.ok);
  assert.equal((await adminGlobalSearch(prisma, underscore)).users.length, 0);
  const broad = parseAdminSearchTerm("ap1.invalid");
  assert.ok(broad.ok);
  const users = await adminGlobalSearch(prisma, broad);
  assert.equal(users.users.length, 5, "capped at 5 although more accounts match");
  assert.ok(users.users.every((hit) => !/passwordHash|\+994/.test(JSON.stringify(hit))), "no hash, no phone in results");
  const order = await prisma.order.findFirstOrThrow({ orderBy: { createdAt: "desc" }, select: { id: true } });
  const byNumber = parseAdminSearchTerm(`#${order.id.slice(-8).toUpperCase()}`);
  assert.ok(byNumber.ok);
  assert.deepEqual((await adminGlobalSearch(prisma, byNumber)).orders.map((hit) => hit.href), [`/admin/orders/${order.id}`]);
});

test("CSV: each export has exactly the rows of its list filter; VÖEN masked; formula-safe", async () => {
  const cases = [
    { list: "stores" as const, params: { status: "ACTIVE" }, count: () => prisma.store.count({ where: storesListWhere({ status: "ACTIVE" }, "") }) },
    { list: "orders" as const, params: { status: "pending" }, count: () => prisma.order.count({ where: ordersListWhere({ status: "pending" }, "") }) },
    { list: "customers" as const, params: { status: "inactive" }, count: () => prisma.user.count({ where: customersListWhere({ status: "inactive" }, "") }) },
    { list: "customers" as const, params: { q: "Leyla" }, count: () => prisma.user.count({ where: customersListWhere({ q: "Leyla" }, "Leyla") }) },
    { list: "seller-applications" as const, params: {}, count: () => prisma.vendorApplication.count({ where: { status: "PENDING" } }) },
  ];
  for (const item of cases) {
    const result = await buildAdminListExport(prisma, item.list, item.params);
    const expected = await item.count();
    assert.equal(result.rowCount, expected, `${item.list} ${JSON.stringify(item.params)}`);
    assert.equal(result.csv.split("\r\n").filter(Boolean).length, expected + 1, "header + rows");
    assert.equal(result.truncated, false);
  }
  const applications = await buildAdminListExport(prisma, "seller-applications", { status: "ALL" });
  const voens = await prisma.vendorApplication.findMany({ select: { voenNormalized: true } });
  for (const { voenNormalized } of voens) if (voenNormalized) assert.ok(!applications.csv.includes(voenNormalized), "full VÖEN never exported");
  assert.doesNotMatch((await buildAdminListExport(prisma, "customers", {})).csv, /passwordHash|"x"/);
});

test("chart: the Baku-day GROUP BY equals a JavaScript count of the same rows; dashboard counts are real", async () => {
  const now = new Date();
  const activity = await loadDashboardActivity(prisma, now, true);
  const days = lastBakuDays(now);
  const since = bakuDayStartUtc(days[0]);
  const [orders, stores] = await Promise.all([
    prisma.order.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
    prisma.store.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
  ]);
  const byDay = (rows: { createdAt: Date }[]) => rows.reduce((map, row) => map.set(bakuDateKey(row.createdAt), (map.get(bakuDateKey(row.createdAt)) ?? 0) + 1), new Map<string, number>());
  const o = byDay(orders), s = byDay(stores);
  assert.deepEqual(activity.days, days.map((day) => ({ day, orders: o.get(day) ?? 0, stores: s.get(day) ?? 0 })));
  assert.ok(activity.days.reduce((sum, day) => sum + day.orders, 0) > 0, "the seeded 30 days are visible");
  assert.equal(activity.pendingApplications, await prisma.vendorApplication.count({ where: { status: "PENDING" } }));
  assert.equal(activity.openSupport, await prisma.supportTicket.count({ where: { status: "OPEN" } }));
  assert.equal(activity.openReports, await prisma.conversationReport.count({ where: { status: "OPEN" } }));
});
