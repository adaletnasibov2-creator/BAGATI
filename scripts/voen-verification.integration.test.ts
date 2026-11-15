/**
 * Admin VÖEN verification against the isolated verification PostgreSQL cluster, in a SCRATCH schema only.
 *
 * Safety: uses only BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL (loopback, port 5433, database name containing "verify")
 * and REQUIRES BAGATI_VERIFY_SCHEMA starting with "vn_" that already has migration 20261115120000. Never applies
 * migrations. Skips (NOT VERIFIED) when the cluster, schema or migration is missing. Removes its rows in `finally`.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { resetVoenVerificationOnChange, revokeVoenVerification, verifiedVoenUserIds, verifyVoen, voenStatusOf, VoenVerificationError } from "../lib/voen-verification";

function guardedScratchUrl(): { url: string } | { refuse: string } | { skip: string } {
  const raw = process.env.BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL;
  if (!raw) return { skip: "verify database URL is not set" };
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { refuse: "the verify URL is not a valid URL" }; }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) return { refuse: "verify database host must be loopback" };
  if (parsed.port !== "5433") return { refuse: "verify database port must be exactly 5433" };
  if (!database.includes("verify")) return { refuse: "verify database name must contain \"verify\"" };
  const schema = process.env.BAGATI_VERIFY_SCHEMA;
  if (!schema) return { skip: "BAGATI_VERIFY_SCHEMA is not set (needs a migrated vn_* scratch schema)" };
  if (!/^vn_[a-z0-9_]{1,40}$/.test(schema)) return { refuse: "BAGATI_VERIFY_SCHEMA must be a vn_* scratch schema" };
  parsed.searchParams.set("schema", schema);
  return { url: parsed.toString() };
}

const code = async (promise: Promise<unknown>) => {
  try { await promise; return "OK"; } catch (error) { if (error instanceof VoenVerificationError) return error.code; throw error; }
};

test("VÖEN verification: verify, stale, revoke, re-verify, reset on change, audit, bulk lookup", { timeout: 120_000 }, async (t) => {
  const guard = guardedScratchUrl();
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  const tag = randomUUID().slice(0, 8);
  const users: string[] = [];
  try {
    try { await prisma.$queryRaw`SELECT 1`; } catch { return t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable"); }
    const [where] = await prisma.$queryRaw<{ db: string; port: number; schema: string }[]>`SELECT current_database() AS db, inet_server_port() AS port, current_schema() AS schema`;
    assert.ok(where.db.includes("verify") && Number(where.port) === 5433 && where.schema.startsWith("vn_"));
    const migrated = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE migration_name = '20261115120000_seller_voen_verification' AND finished_at IS NOT NULL`.catch(() => [{ n: 0 }]);
    if (!migrated[0]?.n) return t.skip("NOT VERIFIED: scratch schema lacks migration 20261115120000 (this test never migrates)");

    const make = async (label: string, extra: Record<string, unknown> = {}) => {
      const row = await prisma.user.create({ data: { email: `${label}-${tag}@vn.invalid`, passwordHash: "x", role: "VENDOR", ...extra } });
      users.push(row.id);
      return row;
    };
    const admin = await make("admin", { role: "ADMIN" });
    const voenA = `7${tag.replace(/\D/g, "").padEnd(6, "3").slice(0, 6)}011`;
    const voenB = `7${tag.replace(/\D/g, "").padEnd(6, "3").slice(0, 6)}022`;
    const seller = await make("seller", { vendorProfile: { create: { displayName: "Seller", voen: voenA } } });

    assert.equal((await voenStatusOf(prisma, seller.id, voenA)).status, "UNVERIFIED");
    assert.equal(await code(verifyVoen(prisma, { adminId: admin.id, userId: seller.id, voen: voenA, note: "ok" })), "INVALID_NOTE", "note too short");
    assert.equal(await code(verifyVoen(prisma, { adminId: admin.id, userId: seller.id, voen: voenB, note: "e-taxes-də yoxlandı" })), "STALE", "not the seller's current VÖEN");
    assert.equal(await code(verifyVoen(prisma, { adminId: admin.id, userId: seller.id, voen: "1234567890", note: "e-taxes-də yoxlandı" })), "INVALID_VOEN");
    await verifyVoen(prisma, { adminId: admin.id, userId: seller.id, voen: voenA, note: "e-taxes-də yoxlandı, ad uyğundur" });
    const verified = await voenStatusOf(prisma, seller.id, voenA);
    assert.equal(verified.status, "VERIFIED");
    assert.equal(verified.verifiedBy, admin.email);
    assert.equal(verified.note, "e-taxes-də yoxlandı, ad uyğundur");
    assert.equal(await code(verifyVoen(prisma, { adminId: admin.id, userId: seller.id, voen: voenA, note: "yenə" })), "ALREADY_VERIFIED");
    assert.deepEqual([...await verifiedVoenUserIds(prisma, [{ userId: seller.id, voen: voenA }, { userId: seller.id, voen: voenB }])], [seller.id]);
    assert.equal((await verifiedVoenUserIds(prisma, [{ userId: seller.id, voen: voenB }])).size, 0, "another VÖEN of the same user is not verified");

    await revokeVoenVerification(prisma, { adminId: admin.id, userId: seller.id, voen: voenA, note: "Səhv təsdiq" });
    assert.equal((await voenStatusOf(prisma, seller.id, voenA)).status, "UNVERIFIED");
    assert.equal(await code(revokeVoenVerification(prisma, { adminId: admin.id, userId: seller.id, voen: voenA, note: "yenə geri" })), "NOT_VERIFIED");
    await verifyVoen(prisma, { adminId: admin.id, userId: seller.id, voen: voenA, note: "Yenidən yoxlandı" });
    assert.equal((await voenStatusOf(prisma, seller.id, voenA)).status, "VERIFIED", "re-verified after a revoke");

    // The seller changes the VÖEN (and back): status resets and does not come back by itself.
    await prisma.$transaction(async (tx) => {
      await tx.vendorProfile.update({ where: { userId: seller.id }, data: { voen: voenB } });
      assert.equal(await resetVoenVerificationOnChange(tx, { userId: seller.id, actorId: seller.id }), 1);
    });
    assert.equal((await voenStatusOf(prisma, seller.id, voenB)).status, "UNVERIFIED");
    await prisma.vendorProfile.update({ where: { userId: seller.id }, data: { voen: voenA } });
    const back = await voenStatusOf(prisma, seller.id, voenA);
    assert.equal(back.status, "UNVERIFIED", "changing back does not restore 'verified'");
    assert.equal(back.revokedNote, "Satıcı VÖEN-i dəyişdi (avtomatik)");

    // An applicant (no profile yet) is verified on the open application's VÖEN; it carries over after approval.
    const applicant = await make("applicant", { role: "CUSTOMER" });
    const voenC = `7${tag.replace(/\D/g, "").padEnd(6, "3").slice(0, 6)}032`;
    await prisma.vendorApplication.create({ data: { userId: applicant.id, openUserId: applicant.id, status: "PENDING", source: "SELF", displayName: "A", voen: voenC, voenNormalized: voenC } });
    await verifyVoen(prisma, { adminId: admin.id, userId: applicant.id, voen: voenC, note: "Müraciətdə yoxlandı" });
    await prisma.vendorProfile.create({ data: { userId: applicant.id, displayName: "A", voen: voenC } });
    assert.equal((await voenStatusOf(prisma, applicant.id, voenC)).status, "VERIFIED", "same (user, VÖEN) after approval");

    const audits = await prisma.auditLog.findMany({ where: { entityType: "User", entityId: seller.id }, orderBy: { createdAt: "asc" }, select: { action: true, actorId: true, metadata: true } });
    assert.deepEqual(audits.map((row) => [row.action, row.actorId]), [
      ["SELLER_VOEN_VERIFIED", admin.id], ["SELLER_VOEN_VERIFICATION_REVOKED", admin.id], ["SELLER_VOEN_VERIFIED", admin.id], ["SELLER_VOEN_VERIFICATION_RESET", seller.id],
    ]);
    assert.doesNotMatch(JSON.stringify(audits.map((row) => row.metadata)), new RegExp(voenA), "the full VÖEN is masked in the audit");
    assert.match(JSON.stringify(audits[0].metadata), /•••••••011/);
  } finally {
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: users } }, { entityId: { in: users } }] } }).catch(() => undefined);
    await prisma.vendorApplication.deleteMany({ where: { userId: { in: users } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: users } } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
