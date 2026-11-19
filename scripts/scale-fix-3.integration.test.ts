/**
 * SCALE-FIX-3 (A8 follow-up) on real PostgreSQL: registration, forgot-password and the existing-account check look the
 * email up through the unique index on lower(btrim(email)) instead of an ILIKE scan.
 *  - same account found for any casing / surrounding spaces; the probe can use "User_email_normalized_key";
 *  - `_` and `%` are ordinary characters now (the old ILIKE treated them as wildcards: recorded below);
 *  - the real forgot-password route answers the same generic 202 body for an existing, missing, inactive or
 *    wildcard-only address, and creates a reset token only for the real active account;
 *  - the real register route answers the same acknowledgement for an existing address (any casing) as for a new one,
 *    and never creates a second account for an existing address.
 *
 * Safety: same guard as scripts/scale-fix-2.integration.test.ts: only BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL
 * (loopback, port 5433, database name containing "verify") and an already-migrated cat_* schema in
 * BAGATI_VERIFY_SCHEMA. Creates rows under a random tag and deletes them at the end. Never migrates, never reads .env.
 * Skips (NOT VERIFIED) when the cluster or schema is missing.
 *
 *   BAGATI_VERIFY_SCHEMA=cat_<name> npx tsx --test scripts/scale-fix-3.integration.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

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
  if (!schema) return { skip: "BAGATI_VERIFY_SCHEMA is not set (needs a migrated cat_* scratch schema)" };
  if (!/^cat_[a-z0-9_]{1,40}$/.test(schema)) return { refuse: "BAGATI_VERIFY_SCHEMA must be a cat_* scratch schema" };
  parsed.searchParams.set("schema", schema);
  return { url: parsed.toString() };
}

const guard = guardedScratchUrl();

test("A8 follow-up: register, forgot-password and existing-account use the normalised-email index", { timeout: 180_000 }, async (t) => {
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  // The routes use the shared client from lib/prisma, which reads DATABASE_URL when first imported.
  process.env.DATABASE_URL = guard.url;
  process.env.SESSION_SECRET ??= "bagati-isolated-scale-fix-3-integration-secret-0123456789";
  process.env.APP_BASE_URL = "http://127.0.0.1:3000";
  delete process.env.EMAIL_ENCRYPTION_KEY;
  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  const tag = randomUUID().replace(/-/g, "").slice(0, 10);
  const userIds: string[] = [];
  try {
    let where: { db: string; port: number; schema: string }[];
    try { where = await prisma.$queryRaw`SELECT current_database() AS db, inet_server_port() AS port, current_schema() AS schema`; }
    catch { return t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable"); }
    assert.ok(where[0].db.includes("verify") && Number(where[0].port) === 5433 && where[0].schema.startsWith("cat_"), "guarded scratch schema");
    const migrated = await prisma.$queryRaw<{ t: string | null }[]>`SELECT to_regclass('"LegalAcceptance"')::text AS t`;
    if (!migrated[0]?.t) return t.skip("NOT VERIFIED: scratch schema is not migrated (this test never migrates)");

    const { findUserIdsByNormalizedEmail } = await import("../lib/login-user-lookup");
    const { existingAccountIdentity } = await import("../lib/existing-account");
    const { NextRequest } = await import("next/server");
    const { POST: forgotPassword } = await import("../app/api/auth/forgot-password/route");
    const { POST: register } = await import("../app/api/auth/register/route");

    const mixed = `Mixed.Case-${tag}@Verify.invalid`;
    const axb = `axb-${tag}@verify.invalid`;
    const make = async (email: string, data: { isActive?: boolean; passwordAuthEnabled?: boolean } = {}) => {
      const user = await prisma.user.create({ data: { email, passwordHash: "$2a$12$abcdefghijklmnopqrstuuJ0yrqJDvW8i2jB9hTzZb1v1lXl5pq1e", role: "CUSTOMER", ...data } });
      userIds.push(user.id);
      return user;
    };
    const u1 = await make(mixed);
    const u2 = await make(axb);
    const inactive = await make(`inactive-${tag}@verify.invalid`, { isActive: false });
    const googleOnly = await make(`google-${tag}@verify.invalid`, { passwordAuthEnabled: false });

    await t.test("lookup: any casing and surrounding spaces find the account; _ and % are plain characters now", async () => {
      assert.deepEqual(await findUserIdsByNormalizedEmail(prisma, mixed.toLowerCase()), [u1.id]);
      assert.deepEqual(await findUserIdsByNormalizedEmail(prisma, mixed.toUpperCase()), [u1.id]);
      assert.deepEqual(await findUserIdsByNormalizedEmail(prisma, `  ${mixed}  `), [u1.id]);
      assert.deepEqual(await findUserIdsByNormalizedEmail(prisma, `nobody-${tag}@verify.invalid`), []);
      assert.deepEqual(await findUserIdsByNormalizedEmail(prisma, mixed, 2), [u1.id], "the unique index allows at most one");
      const wildcard = `a_b-${tag}@verify.invalid`;
      assert.deepEqual(await findUserIdsByNormalizedEmail(prisma, wildcard), []);
      assert.deepEqual(await findUserIdsByNormalizedEmail(prisma, `%-${tag}@verify.invalid`), []);
      // Recorded difference: the old ILIKE lookup found another account from a typed pattern.
      const old = await prisma.user.findFirst({ where: { email: { equals: wildcard, mode: "insensitive" } }, select: { id: true } });
      assert.equal(old?.id, u2.id, "old ILIKE: a_b matched axb");
    });

    await t.test("lookup can be served by the unique index User_email_normalized_key", async () => {
      const plan = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
        return tx.$queryRaw<{ "QUERY PLAN": string }[]>`EXPLAIN SELECT "id" FROM "User" WHERE lower(btrim("email")) = lower(btrim(${mixed})) LIMIT 1`;
      });
      assert.match(plan.map((row) => row["QUERY PLAN"]).join("\n"), /User_email_normalized_key/);
    });

    await t.test("existing-account check: one / none, any casing; wildcards find nothing", async () => {
      assert.deepEqual(await existingAccountIdentity(mixed.toUpperCase()), { kind: "one", id: u1.id, role: "CUSTOMER", isActive: true });
      assert.deepEqual(await existingAccountIdentity(`nobody-${tag}@verify.invalid`), { kind: "none" });
      assert.deepEqual(await existingAccountIdentity(`a_b-${tag}@verify.invalid`), { kind: "none" });
    });

    await t.test("forgot-password: one generic 202 answer for every address; a token only for the real active account", async () => {
      const ask = async (email: string) => {
        const response = await forgotPassword(new NextRequest("http://127.0.0.1:3000/api/auth/forgot-password", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }),
        }));
        return { status: response.status, body: await response.json() };
      };
      const tokens = (userId: string) => prisma.passwordResetToken.count({ where: { userId } });
      const answers = [
        await ask(mixed.toUpperCase()),
        await ask(`nobody-${tag}@verify.invalid`),
        await ask(`a_b-${tag}@verify.invalid`),
        await ask(inactive.email),
        await ask(googleOnly.email),
      ];
      for (const answer of answers) assert.deepEqual(answer, answers[0], "same status and body (no enumeration)");
      assert.equal(answers[0].status, 202);
      assert.equal(await tokens(u1.id), 1, "the real account gets its reset token");
      assert.equal(await tokens(u2.id), 0, "a wildcard address no longer reaches another account");
      assert.equal(await tokens(inactive.id), 0);
      assert.equal(await tokens(googleOnly.id), 0);
    });

    await t.test("register: an existing address (any casing) gets the new-account acknowledgement and no second account", async () => {
      const post = async (email: string) => {
        const response = await register(new NextRequest("http://127.0.0.1:3000/api/auth/register", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password: `Verify-${tag}-password`, firstName: "Test", lastName: "User", acceptTerms: true }),
        }));
        return { status: response.status, body: await response.json() };
      };
      const existing = await post(mixed.toUpperCase());
      const fresh = await post(`fresh-${tag}@verify.invalid`);
      assert.deepEqual(existing, fresh, "same answer for an existing and a new address");
      assert.equal(existing.status, 202);
      const normalizedCount = async (email: string) => (await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "User" WHERE lower(btrim("email")) = lower(btrim(${email}))`)[0].n;
      assert.equal(await normalizedCount(mixed), 1, "no second account for the existing address");
      const created = await prisma.user.findUnique({ where: { email: `fresh-${tag}@verify.invalid` }, select: { id: true } });
      assert.ok(created);
      userIds.push(created.id);
      // a_b@ is a different address from axb@: it can now be registered (the old wildcard lookup treated it as taken).
      const wildcard = await post(`a_b-${tag}@verify.invalid`);
      assert.deepEqual(wildcard, fresh);
      const wildcardUser = await prisma.user.findUnique({ where: { email: `a_b-${tag}@verify.invalid` }, select: { id: true } });
      assert.ok(wildcardUser, "a_b@ registered as its own account");
      userIds.push(wildcardUser.id);
      assert.equal(await normalizedCount(axb), 1, "axb@ untouched");
    });
  } finally {
    if (userIds.length) {
      const ids = userIds;
      await prisma.passwordResetToken.deleteMany({ where: { userId: { in: ids } } });
      await prisma.emailOutbox.deleteMany({ where: { OR: ids.map((id) => ({ dedupeKey: { contains: id } })) } });
      await prisma.legalAcceptance.deleteMany({ where: { userId: { in: ids } } });
      await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.$disconnect();
  }
});
