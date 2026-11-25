/**
 * ADMIN-DESIGN-2 integration (5433 verify database, scratch schema cat_admin_design_2 ONLY; read-only).
 * Proves on real PostgreSQL that the shared helper makes "%" and "_" match literally in every admin search path that
 * can be called without an HTTP request, while ordinary text still matches case-insensitively:
 * - the list builders (stores, orders, customers) and the seller-application list filter;
 * - the section filters (same helper call: brands, cities, products, reviews, support, vendors, imports, notifications);
 * - the VÖEN review list (raw SQL ILIKE) and the security-center events search.
 * The two API routes are checked over HTTP in the live check (see the report).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { adminSearchContains, customersListWhere, ordersListWhere, storesListWhere } from "../lib/admin-list-where";
import { sellerApplicationListWhere } from "../lib/seller-application-service";
import { listSellersForVoenReview } from "../lib/voen-verification";
import { listSecurityEvents } from "../lib/security-center-data";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://refuse@invalid:1/x");
const allowed = url.port === "5433" && ["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname.includes("verify") && url.searchParams.getAll("schema").join() === "cat_admin_design_2";
const prisma = allowed ? new PrismaClient() : (null as unknown as PrismaClient);

test.before(async () => {
  if (!allowed) throw new Error("refuse: DATABASE_URL must be the 5433 verify database with schema=cat_admin_design_2");
  const [where] = await prisma.$queryRaw<{ db: string; port: number; schema: string }[]>`SELECT current_database() AS db, inet_server_port() AS port, current_schema() AS schema`;
  assert.ok(where.db.includes("verify") && Number(where.port) === 5433 && where.schema === "cat_admin_design_2", JSON.stringify(where));
});
test.after(async () => { if (allowed) await prisma.$disconnect(); });

test("the raw Prisma contains still treats % and _ as wildcards (the gap this task closes)", async () => {
  const all = await prisma.user.count();
  assert.equal(await prisma.user.count({ where: { email: { contains: "%", mode: "insensitive" } } }), all);
  assert.equal(await prisma.user.count({ where: { email: adminSearchContains("%") } }), 0);
  assert.equal(await prisma.user.count({ where: { email: adminSearchContains("_") } }), 0);
});

test("list builders: % and _ match nothing; ordinary text matches case-insensitively as before", async () => {
  for (const wild of ["%", "_", "%%", "_%_"]) {
    assert.equal(await prisma.store.count({ where: storesListWhere({}, wild) }), 0, `stores ${wild}`);
    assert.equal(await prisma.order.count({ where: ordersListWhere({}, wild) }), 0, `orders ${wild}`);
    assert.equal(await prisma.user.count({ where: customersListWhere({}, wild) }), 0, `customers ${wild}`);
    assert.equal(await prisma.vendorApplication.count({ where: sellerApplicationListWhere({ status: "ALL", q: wild }) }), 0, `applications ${wild}`);
  }
  assert.equal(await prisma.store.count({ where: storesListWhere({}, "moda evi") }), 1, "case-insensitive: Moda Evi");
  assert.ok(await prisma.user.count({ where: customersListWhere({}, "LEYLA") }) > 0, "case-insensitive first name");
  assert.ok(await prisma.order.count({ where: ordersListWhere({}, "AD2.INVALID") }) > 0, "order by customer e-mail");
});

test("section filters (same helper): % and _ match nothing; text still matches", async () => {
  const q = (text: string) => adminSearchContains(text);
  for (const wild of ["%", "_"]) {
    assert.equal(await prisma.brand.count({ where: { name: q(wild) } }), 0, `brands ${wild}`);
    assert.equal(await prisma.city.count({ where: { name: q(wild) } }), 0, `cities ${wild}`);
    assert.equal(await prisma.product.count({ where: { OR: [{ name: q(wild) }, { sku: q(wild) }, { store: { name: q(wild) } }] } }), 0, `products ${wild}`);
    assert.equal(await prisma.review.count({ where: { OR: [{ comment: q(wild) }, { product: { name: q(wild) } }, { user: { email: q(wild) } }] } }), 0, `reviews ${wild}`);
    assert.equal(await prisma.supportTicket.count({ where: { OR: [{ subject: q(wild) }, { user: { email: q(wild) } }] } }), 0, `support ${wild}`);
    assert.equal(await prisma.vendorProfile.count({ where: { OR: [{ displayName: q(wild) }, { user: { email: q(wild) } }] } }), 0, `vendors ${wild}`);
    assert.equal(await prisma.productImport.count({ where: { sourceName: q(wild) } }), 0, `imports ${wild}`);
    assert.equal(await prisma.notification.count({ where: { OR: [{ title: q(wild) }, { body: q(wild) }] } }), 0, `notifications ${wild}`);
  }
  assert.equal(await prisma.brand.count({ where: { name: q("moda line") } }), 1);
  assert.ok(await prisma.product.count({ where: { name: q("FİNCAN") } }) + await prisma.product.count({ where: { name: q("fincan") } }) > 0);
});

test("VÖEN review list (raw ILIKE) and security events search: % and _ literal, text still found", async () => {
  for (const wild of ["%", "_"]) {
    const voen = await listSellersForVoenReview(prisma, { filter: "ALL", q: wild, page: 1 });
    assert.equal(voen.total, 0, `voen ${wild}`);
    const events = await listSecurityEvents({ window: "30d", eventType: "", severity: "", q: wild, page: 1 }, new Date());
    assert.equal((events as { total: number }).total, 0, `events ${wild}`);
  }
  assert.ok((await listSellersForVoenReview(prisma, { filter: "ALL", q: "moda", page: 1 })).total >= 1);
  assert.ok(((await listSecurityEvents({ window: "30d", eventType: "", severity: "", q: "WP-LOGIN", page: 1 }, new Date())) as { total: number }).total >= 1, "path search is case-insensitive");
});
