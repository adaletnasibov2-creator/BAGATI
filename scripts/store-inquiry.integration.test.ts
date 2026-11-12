/**
 * Buyer → store message flow against the isolated verification PostgreSQL cluster.
 *
 * Safety: uses ONLY BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL and refuses unless the host is loopback,
 * the port is exactly 5433 and the database name contains "verify". It never reads DATABASE_URL from
 * .env (it overwrites it in-process with the verify URL) and never connects to 5432. Fixture rows are
 * tagged and deleted in `finally`. Skips (NOT VERIFIED) when the cluster or the StoreInquiry table is
 * missing; it never applies migrations itself.
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
  return { url: raw };
}

test("store inquiry flow: eligible stores only, stored without SMTP, outbox notification, DB guards, rate limit", { timeout: 120_000 }, async (t) => {
  const guard = guardedVerifyUrl();
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  // The shared client (lib/prisma) and the rate limiter must also hit the verify database only.
  process.env.DATABASE_URL = guard.url;
  process.env.SESSION_SECRET ??= "bagati-isolated-store-inquiry-integration-secret";
  delete process.env.EMAIL_ENCRYPTION_KEY;

  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  const tag = randomUUID().replace(/-/g, "").slice(0, 10);
  const ids = { users: [] as string[], stores: [] as string[], cityId: "" };
  const storeEmail = `inquiry-store-${tag}@verify.invalid`;
  const rateKeys: string[] = [];
  try {
    let where: Array<{ db: string; port: number }>;
    try { where = await prisma.$queryRaw`SELECT current_database() AS db, inet_server_port() AS port`; }
    catch { return t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable"); }
    assert.ok(where[0]?.db.includes("verify"));
    assert.equal(Number(where[0]?.port), 5433);
    const table = await prisma.$queryRaw<Array<{ t: string | null }>>`SELECT to_regclass('public."StoreInquiry"')::text AS t`;
    if (!table[0]?.t) return t.skip("NOT VERIFIED: StoreInquiry table missing (migration 20261113010000 not applied)");

    const { submitStoreInquiry } = await import("../lib/store-inquiry-submit");
    const { storeInquirySchema, INQUIRY_STORE_RATE_LIMIT } = await import("../lib/store-inquiry");
    const { authRateLimitKey, consumeAuthRateLimit } = await import("../lib/auth-rate-limit");
    const { stableEmailDedupeKey } = await import("../lib/email-outbox-core");

    const city = await prisma.city.create({ data: { name: `Inquiry City ${tag}`, slug: `inquiry-city-${tag}` } });
    ids.cityId = city.id;
    const makeStore = async (label: string, overrides: { status?: "ACTIVE" | "DRAFT"; contactEmail?: string | null } = {}) => {
      const user = await prisma.user.create({ data: { email: `${label}-${tag}@verify.invalid`, passwordHash: "x", role: "VENDOR", vendorProfile: { create: { displayName: label, sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: `${label} MMC`, voen: "1234567890" } } }, include: { vendorProfile: true } });
      ids.users.push(user.id);
      const store = await prisma.store.create({ data: {
        vendorId: user.vendorProfile!.id, cityId: city.id, name: `${label} ${tag}`, slug: `${label}-${tag}`,
        status: overrides.status ?? "ACTIVE", isActive: true, legalInfoApproved: true, adminManaged: true,
        contactEmail: overrides.contactEmail === undefined ? storeEmail : overrides.contactEmail, contactPhone: "+994557614332",
      } });
      ids.stores.push(store.id);
      return store;
    };
    const input = (overrides: Record<string, unknown>) => storeInquirySchema.parse({ name: "Aysel", contactEmail: "buyer@verify.invalid", contactPhone: "", message: "Salam, bu məhsul hələ satışdadır?", website: "", consent: true, ...overrides });

    // 1. Eligible store with a notification email: message stored, outbox row queued (works without SMTP).
    const store = await makeStore("inq");
    const created = await submitStoreInquiry(prisma, { storeId: store.id, data: input({}), ipHash: "a".repeat(64), appBaseUrl: "https://shopbagati.com" });
    assert.equal(created.kind, "CREATED");
    if (created.kind !== "CREATED") throw new Error("unreachable");
    assert.equal(created.emailQueued, true);
    const row = await prisma.storeInquiry.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(row.status, "NEW");
    assert.equal(row.contactEmail, "buyer@verify.invalid");
    assert.equal(row.ipHash, "a".repeat(64));
    const outbox = await prisma.emailOutbox.findUnique({ where: { dedupeKey: stableEmailDedupeKey(`store-inquiry:${created.id}`) } });
    assert.ok(outbox, "notification queued in the outbox");
    assert.equal(outbox.template, "STORE_INQUIRY");
    assert.equal(outbox.recipient, storeEmail);
    assert.equal(outbox.status, "PENDING");
    assert.equal(JSON.stringify(outbox.payload).includes("satışdadır"), false, "payload is encrypted at rest");

    // 2. Phone-only message: stored as E.164.
    const phoneOnly = await submitStoreInquiry(prisma, { storeId: store.id, data: input({ contactEmail: "", contactPhone: "055 761 43 32" }), ipHash: null });
    assert.equal(phoneOnly.kind, "CREATED");
    if (phoneOnly.kind === "CREATED") assert.equal((await prisma.storeInquiry.findUniqueOrThrow({ where: { id: phoneOnly.id } })).contactPhone, "+994557614332");

    // 3. Store without a notification email: message still stored, nothing queued.
    const quiet = await makeStore("quiet", { contactEmail: null });
    const quietResult = await submitStoreInquiry(prisma, { storeId: quiet.id, data: input({}), ipHash: null });
    assert.deepEqual(quietResult.kind === "CREATED" && quietResult.emailQueued, false);

    // 4. Store that is not publicly visible: refused, nothing stored.
    const draft = await makeStore("draft", { status: "DRAFT" });
    assert.deepEqual(await submitStoreInquiry(prisma, { storeId: draft.id, data: input({}), ipHash: null }), { kind: "NOT_FOUND" });
    assert.equal(await prisma.storeInquiry.count({ where: { storeId: draft.id } }), 0);
    assert.deepEqual(await submitStoreInquiry(prisma, { storeId: `missing-${tag}`, data: input({}), ipHash: null }), { kind: "NOT_FOUND" });

    // 5. Database guards: a message without any reply contact is rejected.
    await assert.rejects(prisma.storeInquiry.create({ data: { storeId: store.id, name: "X", message: "Salam dünya, mesaj." } }));

    // 6. Seller "mark as read" is scoped to the store.
    const otherStoreBefore = await prisma.storeInquiry.count({ where: { storeId: quiet.id, status: "NEW" } });
    const marked = await prisma.storeInquiry.updateMany({ where: { storeId: store.id, status: "NEW" }, data: { status: "READ", readAt: new Date() } });
    assert.equal(marked.count, 2);
    assert.equal(await prisma.storeInquiry.count({ where: { storeId: quiet.id, status: "NEW" } }), otherStoreBefore);

    // 7. Per-store rate limit (database-backed helper): the limit+1-th message in the window is refused.
    const storeKey = authRateLimitKey("store-inquiry", `store:${store.id}`);
    rateKeys.push(storeKey);
    for (let index = 0; index < INQUIRY_STORE_RATE_LIMIT.limit; index += 1) {
      assert.equal(await consumeAuthRateLimit(storeKey, INQUIRY_STORE_RATE_LIMIT.limit, INQUIRY_STORE_RATE_LIMIT.windowMs), true, `attempt ${index + 1}`);
    }
    assert.equal(await consumeAuthRateLimit(storeKey, INQUIRY_STORE_RATE_LIMIT.limit, INQUIRY_STORE_RATE_LIMIT.windowMs), false);
  } finally {
    // Clean up every fixture row (StoreInquiry rows cascade with their store).
    await prisma.emailOutbox.deleteMany({ where: { recipient: storeEmail } }).catch(() => undefined);
    if (rateKeys.length) await prisma.authRateLimit.deleteMany({ where: { keyHash: { in: rateKeys } } }).catch(() => undefined);
    if (ids.stores.length) await prisma.store.deleteMany({ where: { id: { in: ids.stores } } }).catch(() => undefined);
    if (ids.users.length) {
      await prisma.vendorProfile.deleteMany({ where: { userId: { in: ids.users } } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: { in: ids.users } } }).catch(() => undefined);
    }
    if (ids.cityId) await prisma.city.delete({ where: { id: ids.cityId } }).catch(() => undefined);
    await prisma.$disconnect();
    const { prisma: shared } = await import("../lib/prisma");
    await shared.$disconnect().catch(() => undefined);
  }
});
