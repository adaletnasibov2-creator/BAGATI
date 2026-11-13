/**
 * Seller applications against the isolated verification PostgreSQL cluster.
 *
 * Safety: uses ONLY BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL and refuses unless the host is loopback, the port
 * is exactly 5433 and the database name contains "verify". Optional BAGATI_VERIFY_SCHEMA selects a scratch
 * schema (for example one where the new migration was rehearsed). Never reads .env, never connects to 5432,
 * never applies migrations. Fixture rows are tagged and deleted in `finally`. Skips (NOT VERIFIED) when the
 * cluster or the VendorApplication table is missing.
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
  if (schema) {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) return { refuse: "BAGATI_VERIFY_SCHEMA is not a plain schema name" };
    parsed.searchParams.set("schema", schema);
  }
  return { url: parsed.toString() };
}

test("seller applications: submit, one open, reapply rules, withdraw, approve atomically, reject, duplicate VÖEN, admin rows", { timeout: 180_000 }, async (t) => {
  const guard = guardedVerifyUrl();
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  process.env.DATABASE_URL = guard.url;
  process.env.SESSION_SECRET ??= "bagati-isolated-seller-application-integration-secret";
  delete process.env.EMAIL_ENCRYPTION_KEY;

  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  const tag = randomUUID().replace(/-/g, "").slice(0, 10);
  const userIds: string[] = [];
  try {
    let where: Array<{ db: string; port: number }>;
    try { where = await prisma.$queryRaw`SELECT current_database() AS db, inet_server_port() AS port`; }
    catch { return t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable"); }
    assert.ok(where[0]?.db.includes("verify"));
    assert.equal(Number(where[0]?.port), 5433);
    const table = await prisma.$queryRaw<Array<{ t: string | null }>>`SELECT to_regclass('"VendorApplication"')::text AS t`;
    if (!table[0]?.t) return t.skip("NOT VERIFIED: VendorApplication table missing (migration 20261113030000 not applied in this schema)");

    const service = await import("../lib/seller-application-service");
    const { sellerApplicationInputSchema } = await import("../lib/seller-application");
    const { enqueueEmail } = await import("../lib/email-outbox");
    const enqueue = (tx: Parameters<typeof enqueueEmail>[0], email: Parameters<typeof enqueueEmail>[1]) => enqueueEmail(tx, email);
    const { SellerApplicationError } = service;
    const code = async (promise: Promise<unknown>) => {
      try { await promise; return "OK"; } catch (error) { if (error instanceof SellerApplicationError) return error.code; throw error; }
    };

    const user = async (label: string, extra: Record<string, unknown> = {}) => {
      const created = await prisma.user.create({ data: { email: `sa-${label}-${tag}@verify.invalid`, passwordHash: "x", role: "CUSTOMER", emailVerifiedAt: new Date(), ...extra } });
      userIds.push(created.id);
      return created;
    };
    const admin = await user("admin", { role: "ADMIN" });
    const voen = `9${tag.replace(/\D/g, "").padEnd(9, "7").slice(0, 9)}`;
    const input = (overrides: Record<string, unknown> = {}) => sellerApplicationInputSchema.parse({
      displayName: "Fixture Seller", phone: "055 123 45 67", sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: "Fixture Sahibkar", voen, ...overrides,
    });

    await t.test("submit keeps CUSTOMER, writes PENDING + audit + outbox; a second open application is refused", async () => {
      const applicant = await user("submit");
      const application = await service.submitSellerApplication(prisma, { userId: applicant.id, data: input(), enqueue });
      const row = await prisma.vendorApplication.findUniqueOrThrow({ where: { id: application.id } });
      assert.equal(row.status, "PENDING");
      assert.equal(row.openUserId, applicant.id);
      assert.equal(row.voenNormalized, voen);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: applicant.id } })).role, "CUSTOMER");
      assert.equal(await prisma.vendorProfile.count({ where: { userId: applicant.id } }), 0);
      assert.equal(await prisma.auditLog.count({ where: { entityId: application.id, action: "SELLER_APPLICATION_SUBMITTED" } }), 1);
      assert.equal(await prisma.emailOutbox.count({ where: { recipient: applicant.email, template: "SELLER_APPLICATION_SUBMITTED" } }), 1);
      assert.equal(await code(service.submitSellerApplication(prisma, { userId: applicant.id, data: input(), enqueue })), "OPEN");
      // The database itself refuses a second open row, even bypassing the service.
      await assert.rejects(prisma.vendorApplication.create({ data: { userId: applicant.id, openUserId: applicant.id, displayName: "x", voenNormalized: voen } }), /Unique constraint/);
      // Two simultaneous submissions by another user: exactly one succeeds.
      const racer = await user("race");
      const results = await Promise.all([1, 2].map(() => code(service.submitSellerApplication(prisma, { userId: racer.id, data: input(), enqueue }))));
      assert.deepEqual(results.sort(), ["OK", "OPEN"]);
    });

    await t.test("unverified or non-customer accounts cannot submit", async () => {
      const unverified = await user("unverified", { emailVerifiedAt: null });
      assert.equal(await code(service.submitSellerApplication(prisma, { userId: unverified.id, data: input(), enqueue })), "ACCOUNT_CHANGED");
      assert.equal(await code(service.submitSellerApplication(prisma, { userId: admin.id, data: input(), enqueue })), "ACCOUNT_CHANGED");
    });

    await t.test("withdraw, then the 24 hour wait; only the owner can withdraw", async () => {
      const applicant = await user("withdraw");
      const other = await user("other");
      const application = await service.submitSellerApplication(prisma, { userId: applicant.id, data: input(), enqueue });
      assert.equal(await code(service.withdrawSellerApplication(prisma, { userId: other.id, applicationId: application.id })), "NOT_FOUND");
      await service.withdrawSellerApplication(prisma, { userId: applicant.id, applicationId: application.id });
      const row = await prisma.vendorApplication.findUniqueOrThrow({ where: { id: application.id } });
      assert.equal(row.status, "WITHDRAWN");
      assert.equal(row.openUserId, null);
      assert.ok(row.withdrawnAt);
      assert.equal(await prisma.auditLog.count({ where: { entityId: application.id, action: "SELLER_APPLICATION_WITHDRAWN", actorId: applicant.id } }), 1);
      assert.equal(await code(service.withdrawSellerApplication(prisma, { userId: applicant.id, applicationId: application.id })), "NOT_PENDING");
      assert.equal(await code(service.submitSellerApplication(prisma, { userId: applicant.id, data: input(), enqueue })), "WAIT");
      const later = new Date(Date.now() + 24 * 60 * 60 * 1000 + 60_000);
      assert.equal(await code(service.submitSellerApplication(prisma, { userId: applicant.id, data: input(), enqueue, now: later })), "OK");
    });

    await t.test("at most 3 customer applications in a rolling 30 days", async () => {
      const applicant = await user("limit");
      const day = 24 * 60 * 60 * 1000;
      for (const daysAgo of [20, 10, 5]) {
        await prisma.vendorApplication.create({ data: {
          userId: applicant.id, status: "REJECTED", source: "SELF", displayName: "x", voenNormalized: voen,
          rejectionReason: "fixture reason", reviewedAt: new Date(Date.now() - (daysAgo - 1) * day), createdAt: new Date(Date.now() - daysAgo * day),
        } });
      }
      assert.equal(await code(service.submitSellerApplication(prisma, { userId: applicant.id, data: input(), enqueue })), "LIMIT");
      assert.equal(await code(service.submitSellerApplication(prisma, { userId: applicant.id, data: input(), enqueue, now: new Date(Date.now() + 11 * day) })), "OK");
    });

    await t.test("approval is atomic: a failure inside the transaction leaves everything unchanged", async () => {
      const applicant = await user("atomic");
      const application = await service.submitSellerApplication(prisma, { userId: applicant.id, data: input({ voen: "1112223330" }), enqueue });
      const failing = async () => { throw new Error("simulated outbox failure"); };
      await assert.rejects(service.approveSellerApplication(prisma, { applicationId: application.id, adminId: admin.id, confirmDuplicateVoen: false, adminNote: null, enqueue: failing }), /simulated outbox failure/);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: applicant.id } })).role, "CUSTOMER");
      assert.equal(await prisma.vendorProfile.count({ where: { userId: applicant.id } }), 0);
      assert.equal((await prisma.vendorApplication.findUniqueOrThrow({ where: { id: application.id } })).status, "PENDING");
      assert.equal(await prisma.auditLog.count({ where: { entityId: application.id, action: "SELLER_APPLICATION_APPROVED" } }), 0);

      const result = await service.approveSellerApplication(prisma, { applicationId: application.id, adminId: admin.id, confirmDuplicateVoen: false, adminNote: "ok", enqueue });
      const account = await prisma.user.findUniqueOrThrow({ where: { id: applicant.id }, include: { vendorProfile: true } });
      assert.equal(account.role, "VENDOR");
      assert.equal(account.vendorProfile?.id, result.vendorProfileId);
      assert.equal(account.vendorProfile?.voen, "1112223330");
      assert.equal(account.vendorProfile?.legalName, "Fixture Sahibkar");
      const row = await prisma.vendorApplication.findUniqueOrThrow({ where: { id: application.id } });
      assert.equal(row.status, "APPROVED");
      assert.equal(row.reviewedById, admin.id);
      assert.equal(row.vendorProfileId, result.vendorProfileId);
      assert.equal(row.openUserId, null);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: application.id, action: "SELLER_APPLICATION_APPROVED" } });
      assert.doesNotMatch(JSON.stringify(audit.metadata), /1112223330|Fixture Sahibkar/, "no personal data in audit metadata");
      assert.equal(await prisma.emailOutbox.count({ where: { recipient: applicant.email, template: "SELLER_APPLICATION_APPROVED" } }), 1);
      assert.equal(await code(service.approveSellerApplication(prisma, { applicationId: application.id, adminId: admin.id, confirmDuplicateVoen: false, adminNote: null, enqueue })), "NOT_PENDING");
    });

    await t.test("rejection keeps CUSTOMER, stores the reason and queues the e-mail", async () => {
      const applicant = await user("reject");
      const application = await service.submitSellerApplication(prisma, { userId: applicant.id, data: input({ voen: "2223334440" }), enqueue });
      await service.rejectSellerApplication(prisma, { applicationId: application.id, adminId: admin.id, reason: "VÖEN sənədi uyğun deyil", adminNote: null, enqueue });
      const row = await prisma.vendorApplication.findUniqueOrThrow({ where: { id: application.id } });
      assert.equal(row.status, "REJECTED");
      assert.equal(row.rejectionReason, "VÖEN sənədi uyğun deyil");
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: applicant.id } })).role, "CUSTOMER");
      assert.equal(await prisma.emailOutbox.count({ where: { recipient: applicant.email, template: "SELLER_APPLICATION_REJECTED" } }), 1);
      // The database refuses a REJECTED row without a reason.
      await assert.rejects(prisma.vendorApplication.update({ where: { id: application.id }, data: { rejectionReason: " " } }), /check constraint|rejection_reason/i);
    });

    await t.test("concurrent approve and reject: exactly one decision wins", async () => {
      const applicant = await user("concurrent");
      const application = await service.submitSellerApplication(prisma, { userId: applicant.id, data: input({ voen: "3334445550" }), enqueue });
      const results = await Promise.all([
        code(service.approveSellerApplication(prisma, { applicationId: application.id, adminId: admin.id, confirmDuplicateVoen: false, adminNote: null, enqueue })),
        code(service.rejectSellerApplication(prisma, { applicationId: application.id, adminId: admin.id, reason: "parallel rejection", adminNote: null, enqueue })),
      ]);
      assert.deepEqual([...results].sort(), ["NOT_PENDING", "OK"]);
      const row = await prisma.vendorApplication.findUniqueOrThrow({ where: { id: application.id } });
      const role = (await prisma.user.findUniqueOrThrow({ where: { id: applicant.id } })).role;
      assert.equal(role, row.status === "APPROVED" ? "VENDOR" : "CUSTOMER");
    });

    await t.test("duplicate VÖEN must be confirmed explicitly; the confirmation is recorded", async () => {
      const shared = "4445556660";
      const seller = await user("dup-seller", { role: "VENDOR", vendorProfile: { create: { displayName: "Existing", voen: "444 555 6660" } } });
      assert.ok(seller);
      const applicant = await user("dup");
      const application = await service.submitSellerApplication(prisma, { userId: applicant.id, data: input({ voen: shared }), enqueue });
      const matches = await service.findDuplicateVoen(prisma, { applicationId: application.id, userId: applicant.id, voenNormalized: shared });
      assert.equal(matches.profiles.length, 1);
      assert.equal(await code(service.approveSellerApplication(prisma, { applicationId: application.id, adminId: admin.id, confirmDuplicateVoen: false, adminNote: null, enqueue })), "DUPLICATE_VOEN_UNCONFIRMED");
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: applicant.id } })).role, "CUSTOMER");
      const flags = await service.duplicateVoenFlags(prisma, [{ id: application.id, userId: applicant.id, voenNormalized: shared }]);
      assert.ok(flags.has(application.id));
      await service.approveSellerApplication(prisma, { applicationId: application.id, adminId: admin.id, confirmDuplicateVoen: true, adminNote: null, enqueue });
      const row = await prisma.vendorApplication.findUniqueOrThrow({ where: { id: application.id } });
      assert.equal(row.duplicateVoenConfirmed, true);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: application.id, action: "SELLER_APPLICATION_APPROVED" } });
      assert.equal((audit.metadata as Record<string, unknown>).duplicateVoenConfirmed, true);
    });

    await t.test("admin-created sellers get an APPROVED/ADMIN row; older VÖEN formats are accepted there", async () => {
      const created = await prisma.$transaction(async (tx) => {
        const seller = await tx.user.create({ data: { email: `sa-admin-made-${tag}@verify.invalid`, passwordHash: "x", role: "VENDOR", vendorProfile: { create: { displayName: "Admin Made", voen: "AZ-123" } } }, include: { vendorProfile: true } });
        const application = await service.recordAdminCreatedSeller(tx, {
          userId: seller.id, vendorProfileId: seller.vendorProfile!.id, adminId: admin.id, displayName: "Admin Made", phone: null,
          sellerType: "REGISTERED_COMPANY", legalName: "Admin Made MMC", voen: "AZ-123", legalAddress: "Bakı", storeName: "Admin Store", now: new Date(),
        });
        return { seller, application };
      });
      userIds.push(created.seller.id);
      const row = await prisma.vendorApplication.findUniqueOrThrow({ where: { id: created.application.id } });
      assert.equal(row.status, "APPROVED");
      assert.equal(row.source, "ADMIN");
      assert.equal(row.voenNormalized, "123");
      assert.equal(row.reviewedById, admin.id);
      // A SELF row with the same short VÖEN is refused by the database.
      await assert.rejects(prisma.vendorApplication.create({ data: { userId: created.seller.id, status: "WITHDRAWN", withdrawnAt: new Date(), displayName: "x", voenNormalized: "123" } }), /check constraint|self_voen/i);
    });

    await t.test("applicant state reports the latest application and the reapply time", async () => {
      const applicant = await user("state");
      const empty = await service.applicantState(prisma, applicant.id);
      assert.equal(empty.latest, null);
      assert.deepEqual(empty.decision, { allowed: true });
      const application = await service.submitSellerApplication(prisma, { userId: applicant.id, data: input({ voen: "5556667770" }), enqueue });
      await service.rejectSellerApplication(prisma, { applicationId: application.id, adminId: admin.id, reason: "Məlumat natamamdır", adminNote: null, enqueue });
      const state = await service.applicantState(prisma, applicant.id);
      assert.equal(state.latest?.status, "REJECTED");
      assert.equal(state.latest?.rejectionReason, "Məlumat natamamdır");
      assert.equal(state.decision.allowed, false);
    });
  } finally {
    if (userIds.length) {
      const applications = await prisma.vendorApplication.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
      await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: applications.map((row) => row.id) } }] } });
      await prisma.emailOutbox.deleteMany({ where: { recipient: { endsWith: `-${tag}@verify.invalid` } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      const left = await prisma.user.count({ where: { email: { endsWith: `-${tag}@verify.invalid` } } });
      assert.equal(left, 0, "fixtures removed");
    }
    await prisma.$disconnect();
  }
});
