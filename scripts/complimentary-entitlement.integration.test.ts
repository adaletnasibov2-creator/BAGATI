/**
 * Free-selling grants against the isolated verification PostgreSQL cluster.
 *
 * Safety: uses ONLY BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL and refuses unless the host is loopback,
 * the port is exactly 5433 and the database name contains "verify". It never reads DATABASE_URL and
 * never connects to 5432. Everything runs inside ONE interactive transaction that is always rolled
 * back, so no row survives the test. It skips (NOT VERIFIED) when the variable, the cluster or the
 * migration 20261112010000_complimentary_entitlement_tier_ends_at is missing. It never applies migrations.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient, type Prisma } from "@prisma/client";

const VERIFY_URL_ENV = "BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL";
const ROLLBACK = "BAGATI_TEST_ROLLBACK";

function guardedVerifyUrl(): { url: string } | { refuse: string } | { skip: string } {
  const raw = process.env[VERIFY_URL_ENV];
  if (!raw) return { skip: `${VERIFY_URL_ENV} is not set` };
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { refuse: `${VERIFY_URL_ENV} is not a valid URL` }; }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) return { refuse: "verify database host must be loopback" };
  if (parsed.port !== "5433") return { refuse: "verify database port must be exactly 5433" };
  if (!database.includes("verify")) return { refuse: "verify database name must contain \"verify\"" };
  return { url: raw };
}

test("free-selling grants: path (1) unchanged, path (2) publishes, SQL and JS agree, paid activation revokes", { timeout: 120_000 }, async (t) => {
  const guard = guardedVerifyUrl();
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  // Any accidental use of the default client also lands on the verify database, never 5432.
  process.env.DATABASE_URL = guard.url;
  process.env.SESSION_SECRET ??= "bagati-isolated-complimentary-test-secret-32";
  delete process.env.EMAIL_ENCRYPTION_KEY;

  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  try {
    let where: Array<{ db: string; port: number }>;
    try { where = await prisma.$queryRaw`SELECT current_database() AS db, inet_server_port() AS port`; }
    catch { return t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable"); }
    assert.ok(where[0]?.db.includes("verify"), "connected database name must contain \"verify\"");
    assert.equal(Number(where[0]?.port), 5433, "connected server port must be 5433");
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`SELECT column_name FROM information_schema.columns WHERE table_name = 'StoreComplimentaryEntitlement' AND column_name IN ('tier', 'endsAt')`;
    if (columns.length !== 2) return t.skip("NOT VERIFIED: verify database lacks StoreComplimentaryEntitlement.tier/endsAt (migrations 20261109010000 and 20261112010000 not applied)");

    const { runStoreReviewTransaction } = await import("../lib/store-review-transaction");
    const { saveManualSubscription } = await import("../lib/admin-manual-subscription");
    const { revokeComplimentary } = await import("../lib/complimentary-entitlements");
    const { publicStoreWhere } = await import("../lib/seller-legal-policy");
    const { isPublicStoreEligible } = await import("../lib/public-store-eligibility");
    const { activeComplimentaryEntitlementSelect } = await import("../lib/subscription-entitlements");

    const tag = randomUUID().replace(/-/g, "").slice(0, 10);
    const now = new Date();
    const subscriptionBlocker = "Satış üçün aktiv, qüvvədə olan Basic və ya Pro abunəliyi tələb olunur.";

    await assert.rejects(prisma.$transaction(async (tx) => {
      const city = await tx.city.create({ data: { name: `Free City ${tag}`, slug: `free-city-${tag}` } });
      const category = await tx.category.create({ data: { name: `Free Cat ${tag}`, slug: `free-cat-${tag}` } });
      const basic = await tx.subscriptionPlan.upsert({ where: { slug: "basic" }, update: { isActive: true }, create: { name: "BASIC", slug: "basic", monthlyPrice: "20.00" } });
      const admin = await tx.user.create({ data: { email: `admin-${tag}@free.invalid`, passwordHash: "x", role: "ADMIN" } });

      const makeStore = async (label: string, subscription: "PENDING" | "ACTIVE") => {
        const user = await tx.user.create({ data: { email: `${label}-${tag}@free.invalid`, passwordHash: "x", role: "VENDOR", vendorProfile: { create: { displayName: label, sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: `${label} MMC`, voen: "1234567890" } } }, include: { vendorProfile: true } });
        const store = await tx.store.create({ data: { vendorId: user.vendorProfile!.id, cityId: city.id, name: `${label} ${tag}`, slug: `${label}-${tag}`, status: "PENDING_REVIEW" } });
        await tx.storeSubscription.create({ data: { storeId: store.id, planId: basic.id, status: subscription, ...(subscription === "ACTIVE" ? { currentPeriodStart: new Date(now.getTime() - 86_400_000), currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000) } : {}) } });
        const product = await tx.product.create({ data: { storeId: store.id, name: `${label} məhsul`, slug: `${label}-product-${tag}`, price: "10.00", categoryId: category.id } });
        await tx.inventory.create({ data: { productId: product.id, quantity: 5 } });
        return { store, product };
      };
      const review = (storeId: string, freeGrant: Parameters<typeof runStoreReviewTransaction>[1]["freeGrant"]) =>
        runStoreReviewTransaction(tx, { storeId, adminId: admin.id, action: "approve", freeGrant });
      const grants = (storeId: string) => tx.storeComplimentaryEntitlement.findMany({ where: { storeId }, orderBy: { grantedAt: "asc" } });
      const productStatus = async (id: string) => (await tx.product.findUniqueOrThrow({ where: { id } })).status;

      // Path (1): no free option, no active paid subscription -> approved but hidden, subscription blocker, nothing published.
      const unpaid = await makeStore("unpaid", "PENDING");
      const unpaidOutcome = await review(unpaid.store.id, null);
      assert.equal(unpaidOutcome.kind, "UPDATED");
      if (unpaidOutcome.kind !== "UPDATED") throw new Error("unreachable");
      assert.equal(unpaidOutcome.item?.status, "ACTIVE");
      assert.equal(unpaidOutcome.item?.isActive, false);
      assert.deepEqual(unpaidOutcome.activationBlockers, [subscriptionBlocker]);
      assert.equal(await productStatus(unpaid.product.id), "DRAFT");
      assert.equal((await grants(unpaid.store.id)).length, 0);

      // Path (1): active in-period paid subscription -> sells normally, no grant created.
      const paid = await makeStore("paid", "ACTIVE");
      const paidOutcome = await review(paid.store.id, null);
      assert.equal(paidOutcome.kind === "UPDATED" && paidOutcome.item?.isActive, true);
      assert.equal(await productStatus(paid.product.id), "ACTIVE");
      assert.equal((await grants(paid.store.id)).length, 0);

      // Path (2): free option ON -> grant row in the same transaction, store public, eligible draft published.
      const free = await makeStore("free", "PENDING");
      const freeOutcome = await review(free.store.id, { tier: "BASIC", endsAt: null, reason: "Tərəfdaş mağaza, pulsuz satış" });
      assert.equal(freeOutcome.kind === "UPDATED" && freeOutcome.item?.isActive, true);
      assert.deepEqual(freeOutcome.kind === "UPDATED" && freeOutcome.activationBlockers, []);
      assert.equal(await productStatus(free.product.id), "ACTIVE");
      const freeGrants = await grants(free.store.id);
      assert.equal(freeGrants.length, 1);
      assert.equal(freeGrants[0].tier, "BASIC");
      assert.equal(freeGrants[0].grantedByAdminId, admin.id);
      assert.ok(await tx.auditLog.findFirst({ where: { action: "ADMIN_COMPLIMENTARY_GRANT", entityId: freeGrants[0].id, actorId: admin.id } }));

      // A second free approval is refused and changes nothing.
      assert.equal((await review(free.store.id, { tier: "PRO", endsAt: null, reason: "İkinci dəfə verilir" })).kind, "ALREADY_GRANTED");
      assert.equal((await grants(free.store.id)).length, 1);

      // Database guards: one unrevoked grant per store; end date after grant time.
      await tx.$executeRawUnsafe("SAVEPOINT dup");
      await assert.rejects(tx.storeComplimentaryEntitlement.create({ data: { storeId: free.store.id, grantedByAdminId: admin.id, grantReason: "dublikat icazə" } }), (error: { code?: string }) => error.code === "P2002");
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT dup");
      await tx.$executeRawUnsafe("SAVEPOINT endcheck");
      await assert.rejects(tx.storeComplimentaryEntitlement.create({ data: { storeId: unpaid.store.id, grantedByAdminId: admin.id, grantReason: "keçmiş tarix", endsAt: new Date(now.getTime() - 86_400_000) } }));
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT endcheck");

      // SQL filter and JS rule agree on the real rows.
      const ids = [unpaid.store.id, paid.store.id, free.store.id];
      const parity = async () => {
        const sql = new Set((await tx.store.findMany({ where: { id: { in: ids }, ...publicStoreWhere(new Date()) }, select: { id: true } })).map((row) => row.id));
        const candidates = await tx.store.findMany({ where: { id: { in: ids } }, select: {
          id: true, status: true, isActive: true, legalInfoApproved: true, adminManaged: true, city: { select: { isActive: true } },
          vendor: { select: { sellerType: true, legalName: true, voen: true, legalAddress: true, user: { select: { isActive: true } } } },
          subscription: { select: { status: true, currentPeriodStart: true, currentPeriodEnd: true, plan: { select: { isActive: true, slug: true } } } },
          complimentaryEntitlements: activeComplimentaryEntitlementSelect,
        } });
        const js = new Set(candidates.filter((candidate) => isPublicStoreEligible(candidate)).map((candidate) => candidate.id));
        assert.deepEqual([...sql].sort(), [...js].sort());
        return sql;
      };
      assert.deepEqual([...await parity()].sort(), [paid.store.id, free.store.id].sort());

      // An expired grant stops selling (SQL and JS), without any job.
      await tx.$executeRaw`UPDATE "StoreComplimentaryEntitlement" SET "grantedAt" = ${new Date(now.getTime() - 2 * 86_400_000)}, "endsAt" = ${new Date(now.getTime() - 60_000)} WHERE "id" = ${freeGrants[0].id}`;
      assert.equal((await parity()).has(free.store.id), false);
      await tx.$executeRaw`UPDATE "StoreComplimentaryEntitlement" SET "endsAt" = NULL WHERE "id" = ${freeGrants[0].id}`;
      assert.equal((await parity()).has(free.store.id), true);

      // Saving an ACTIVE paid subscription revokes the grant in the same transaction; the store keeps selling on the paid plan.
      const saved = await saveManualSubscription(tx, {
        storeId: free.store.id, planId: basic.id, status: "ACTIVE",
        periodStart: new Date(now.getTime() - 86_400_000), periodEnd: new Date(now.getTime() + 30 * 86_400_000),
        reason: "Ödənişli BASIC-ə keçid", adminId: admin.id, now,
      });
      assert.equal("item" in saved && saved.complimentaryRevoked, true);
      const afterPaid = await grants(free.store.id);
      assert.ok(afterPaid[0].revokedAt);
      assert.match(afterPaid[0].revokeReason ?? "", /Ödənişli abunəlik aktivləşdirildi/);
      assert.equal((await parity()).has(free.store.id), true);

      // Revoking a grant with no paid subscription takes the store out of sale.
      const third = await makeStore("third", "PENDING");
      await review(third.store.id, { tier: "PRO", endsAt: null, reason: "Müvəqqəti pulsuz satış" });
      ids.push(third.store.id);
      assert.equal((await parity()).has(third.store.id), true);
      assert.equal((await revokeComplimentary(tx, { storeId: third.store.id, adminId: admin.id, reason: "Müddət bitdi, ləğv", source: "ADMIN_PANEL" })).kind, "REVOKED");
      assert.equal((await parity()).has(third.store.id), false);

      throw new Error(ROLLBACK);
    }, { timeout: 60_000, isolationLevel: "Serializable" as Prisma.TransactionIsolationLevel }), (error: Error) => error.message === ROLLBACK);
  } finally {
    await prisma.$disconnect();
  }
});
