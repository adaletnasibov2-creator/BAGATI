/**
 * Legal acceptance Phase B against the isolated verification PostgreSQL cluster: the real register route (new account
 * and the resume path), the checkout and seller-panel gates (409 then success), the seller application, idempotency.
 *
 * Safety: uses ONLY BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL and refuses unless the host is loopback, the port is
 * exactly 5433 and the database name contains "verify". BAGATI_VERIFY_SCHEMA must name a cat_* scratch schema where
 * all migrations incl. 20261118020000_legal_acceptance are applied; without it the test skips. Never reads .env,
 * never connects to 5432, never applies migrations. Fixture rows are tagged and deleted in `finally`.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const VERIFY_URL_ENV = "BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL";

function guardedVerifyUrl(): { url: string } | { refuse: string } | { skip: string } {
  const raw = process.env[VERIFY_URL_ENV];
  if (!raw) return { skip: `${VERIFY_URL_ENV} is not set` };
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { refuse: `${VERIFY_URL_ENV} is not a valid URL` }; }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) return { refuse: "verify database host must be loopback" };
  if (parsed.port !== "5433") return { refuse: "verify database port must be exactly 5433" };
  if (!database.includes("verify")) return { refuse: "verify database name must contain \"verify\"" };
  const schema = process.env.BAGATI_VERIFY_SCHEMA;
  if (!schema) return { skip: "BAGATI_VERIFY_SCHEMA is not set (a migrated cat_* scratch schema is required)" };
  if (!/^cat_[a-z0-9_]{1,58}$/.test(schema)) return { refuse: "BAGATI_VERIFY_SCHEMA must be a plain cat_* schema name" };
  parsed.searchParams.set("schema", schema);
  return { url: parsed.toString() };
}

test("legal acceptance Phase B: register (new + resume), checkout gate, seller gate, seller application, idempotency", { timeout: 180_000 }, async (t) => {
  const guard = guardedVerifyUrl();
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  // The route modules use the shared client from lib/prisma, which reads DATABASE_URL when first imported.
  process.env.DATABASE_URL = guard.url;
  process.env.SESSION_SECRET ??= "bagati-isolated-legal-acceptance-b-integration-secret";
  delete process.env.EMAIL_ENCRYPTION_KEY;

  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  const tag = randomUUID().replace(/-/g, "").slice(0, 10);
  const emailOf = (label: string) => `lab-${label}-${tag}@verify.invalid`;
  const userIds: string[] = [];
  try {
    let where: Array<{ db: string; port: number; schema: string }>;
    try { where = await prisma.$queryRaw`SELECT current_database() AS db, inet_server_port() AS port, current_schema() AS schema`; }
    catch { return t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable"); }
    assert.ok(where[0]?.db.includes("verify"));
    assert.equal(Number(where[0]?.port), 5433);
    assert.ok(where[0]?.schema.startsWith("cat_"), "running in a cat_* scratch schema");
    const table = await prisma.$queryRaw<Array<{ t: string | null }>>`SELECT to_regclass('"LegalAcceptance"')::text AS t`;
    if (!table[0]?.t) return t.skip("NOT VERIFIED: LegalAcceptance table missing (migration 20261118020000 not applied in this schema)");

    const { NextRequest } = await import("next/server");
    const { POST: register } = await import("../app/api/auth/register/route");
    const { customerTermsGate, sellerTermsGate, acceptSellerTermsInPanel } = await import("../lib/legal-gates");
    const { LEGAL_VERSIONS } = await import("../lib/legal-versions");
    const { LEGAL_TERMS_ACCEPTED } = await import("../lib/legal-acceptance");
    const rows = (userId: string) => prisma.legalAcceptance.findMany({ where: { userId }, orderBy: { acceptedAt: "asc" } });
    const audits = (userId: string) => prisma.auditLog.count({ where: { actorId: userId, action: LEGAL_TERMS_ACCEPTED } });
    const post = (body: Record<string, unknown>) => register(new NextRequest("http://127.0.0.1:3000/api/auth/register", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }));
    const password = `Verify-${tag}-password`;

    await t.test("register without the box: 400 TERMS_REQUIRED and no account", async () => {
      const response = await post({ email: emailOf("nobox"), password, firstName: "Test", lastName: "User" });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, "TERMS_REQUIRED");
      assert.equal(await prisma.user.count({ where: { email: emailOf("nobox") } }), 0);
    });

    await t.test("register with the box: the account and one REGISTER_EMAIL row for the current version, one audit row", async () => {
      const response = await post({ email: emailOf("new"), password, firstName: "Test", lastName: "User", acceptTerms: true });
      assert.equal(response.status, 202);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: emailOf("new") }, select: { id: true } });
      userIds.push(user.id);
      const found = await rows(user.id);
      assert.deepEqual(found.map((r) => [r.document, r.version, r.source, r.vendorApplicationId]), [["CUSTOMER_TERMS", LEGAL_VERSIONS.CUSTOMER_TERMS, "REGISTER_EMAIL", null]]);
      assert.equal(await audits(user.id), 1);
    });

    await t.test("resume path (unverified account, same password) records the acceptance; a repeat is idempotent", async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { email: emailOf("new") }, select: { id: true } });
      // An account from before Phase B has no row: simulate by removing it.
      await prisma.legalAcceptance.deleteMany({ where: { userId: user.id } });
      await prisma.auditLog.deleteMany({ where: { actorId: user.id, action: LEGAL_TERMS_ACCEPTED } });
      const resumed = await post({ email: emailOf("new"), password, acceptTerms: true });
      assert.equal(resumed.status, 202);
      assert.equal(await prisma.user.count({ where: { email: emailOf("new") } }), 1, "no second account");
      assert.deepEqual((await rows(user.id)).map((r) => [r.version, r.source]), [[LEGAL_VERSIONS.CUSTOMER_TERMS, "REGISTER_EMAIL"]]);
      assert.equal(await audits(user.id), 1);
      const again = await post({ email: emailOf("new"), password, acceptTerms: true });
      assert.equal(again.status, 202);
      assert.equal((await rows(user.id)).length, 1, "duplicate acceptance inserts nothing");
      assert.equal(await audits(user.id), 1, "and writes no second audit row");
      // A wrong password is not a resume: nothing is recorded for someone who does not own the account.
      await prisma.legalAcceptance.deleteMany({ where: { userId: user.id } });
      const stranger = await post({ email: emailOf("new"), password: `${password}-other`, acceptTerms: true });
      assert.equal(stranger.status, 202, "same acknowledgement (no account enumeration)");
      assert.equal((await rows(user.id)).length, 0);
    });

    await t.test("checkout gate: 409 TERMS_REQUIRED, then the box records CHECKOUT and lets the order continue", async () => {
      const customer = await prisma.user.create({ data: { email: emailOf("checkout"), passwordHash: "x", role: "CUSTOMER", emailVerifiedAt: new Date() } });
      userIds.push(customer.id);
      const refused = await customerTermsGate(prisma, customer.id, false);
      assert.equal(refused.ok, false);
      if (!refused.ok) { assert.equal(refused.status, 409); assert.equal(refused.code, "TERMS_REQUIRED"); }
      assert.equal((await rows(customer.id)).length, 0);
      assert.deepEqual(await customerTermsGate(prisma, customer.id, true), { ok: true, recorded: true });
      assert.deepEqual((await rows(customer.id)).map((r) => [r.document, r.version, r.source]), [["CUSTOMER_TERMS", LEGAL_VERSIONS.CUSTOMER_TERMS, "CHECKOUT"]]);
      assert.deepEqual(await customerTermsGate(prisma, customer.id, false), { ok: true, recorded: false }, "no checkbox next time");
      assert.deepEqual(await customerTermsGate(prisma, customer.id, true), { ok: true, recorded: false }, "idempotent");
      assert.equal(await audits(customer.id), 1);
    });

    await t.test("seller panel gate: 409 SELLER_TERMS_REQUIRED, then SELLER_PANEL, then open; a second accept records nothing", async () => {
      const seller = await prisma.user.create({ data: { email: emailOf("seller"), passwordHash: "x", role: "VENDOR", emailVerifiedAt: new Date() } });
      userIds.push(seller.id);
      const refused = await sellerTermsGate(prisma, seller.id);
      assert.equal(refused.ok, false);
      if (!refused.ok) { assert.equal(refused.status, 409); assert.equal(refused.code, "SELLER_TERMS_REQUIRED"); }
      assert.deepEqual(await acceptSellerTermsInPanel(prisma, seller.id), { created: true, version: LEGAL_VERSIONS.SELLER_TERMS });
      assert.deepEqual(await sellerTermsGate(prisma, seller.id), { ok: true, recorded: false });
      assert.deepEqual(await acceptSellerTermsInPanel(prisma, seller.id), { created: false, version: LEGAL_VERSIONS.SELLER_TERMS });
      assert.deepEqual((await rows(seller.id)).map((r) => [r.document, r.source]), [["SELLER_TERMS", "SELLER_PANEL"]]);
      assert.equal(await audits(seller.id), 1);
    });

    await t.test("seller application: SELLER_APPLICATION row with the application id, in the submit transaction", async () => {
      const applicant = await prisma.user.create({ data: { email: emailOf("apply"), passwordHash: "x", role: "CUSTOMER", emailVerifiedAt: new Date() } });
      userIds.push(applicant.id);
      const { submitSellerApplication } = await import("../lib/seller-application-service");
      const { sellerApplicationInputSchema } = await import("../lib/seller-application");
      const { enqueueEmail } = await import("../lib/email-outbox");
      // A tagged, valid VÖEN (10 digits, last digit 1 or 2) that no other fixture uses.
      const voen = `9${String(parseInt(tag.slice(0, 7), 16) % 100000000).padStart(8, "0")}1`;
      const data = sellerApplicationInputSchema.parse({ displayName: "Fixture", phone: "055 123 45 67", sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: "Fixture Seller", voen, acceptSellerTerms: true });
      const application = await submitSellerApplication(prisma, { userId: applicant.id, data, enqueue: (tx, email) => enqueueEmail(tx, email) });
      const found = await rows(applicant.id);
      assert.deepEqual(found.map((r) => [r.document, r.version, r.source, r.vendorApplicationId]), [["SELLER_TERMS", LEGAL_VERSIONS.SELLER_TERMS, "SELLER_APPLICATION", application.id]]);
      assert.equal(await audits(applicant.id), 1);
      await prisma.vendorApplication.deleteMany({ where: { userId: applicant.id } });
    });
  } finally {
    if (userIds.length) {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } }).catch(() => undefined);
      await prisma.vendorApplication.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
    }
    await prisma.emailOutbox.deleteMany({ where: { recipient: { endsWith: `-${tag}@verify.invalid` } } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
