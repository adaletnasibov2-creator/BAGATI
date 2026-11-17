/**
 * Messaging notifications through the in-process email worker on real PostgreSQL: rows queued by the REAL messaging
 * service (MESSAGE_TO_STORE / MESSAGE_TO_CUSTOMER) are sent by the REAL outbox batch through a FAKE transport
 * (nothing is ever sent), exactly once per conversation, side and 15-minute window; rows older than 24 h become
 * FAILED / NOTIFICATION_STALE and are never sent; the e-mail is link-only (no message text).
 *
 * Safety: uses only BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL (loopback, port 5433, database name containing "verify")
 * and REQUIRES BAGATI_VERIFY_SCHEMA = a cat_* scratch schema with all migrations including
 * 20261117010000_customer_store_messaging. It never migrates, never reads .env, never connects to 5432. Every batch is
 * targeted at this test's own outbox rows (targetOutboxId), so no other row in the schema is touched. Its own rows
 * (random tag) are deleted at the end.
 *
 *   BAGATI_VERIFY_SCHEMA=cat_messaging npx tsx --test scripts/messaging-email-worker.integration.test.ts
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

test("messaging notifications through the in-process email worker", { timeout: 180_000 }, async (t) => {
  const guard = guardedScratchUrl();
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  process.env.DATABASE_URL = guard.url;
  process.env.SESSION_SECRET ||= "messaging-email-worker-integration-secret-0123456789";
  delete process.env.EMAIL_ENCRYPTION_KEY;
  delete process.env.EMAIL_WORKER_ENABLED;
  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  const tag = `mw${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  try {
    try { await prisma.$queryRaw`SELECT 1`; } catch { return t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable"); }
    const [where] = await prisma.$queryRaw<{ db: string; port: number; schema: string }[]>`SELECT current_database() AS db, inet_server_port() AS port, current_schema() AS schema`;
    assert.ok(where.db.includes("verify") && Number(where.port) === 5433 && where.schema.startsWith("cat_"));
    const migrated = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'Conversation'`;
    if (!migrated[0]?.n) return t.skip("NOT VERIFIED: scratch schema lacks the messaging tables (this test never migrates)");

    const service = await import("../lib/messaging-service");
    const { MESSAGING_LIMIT_DEFAULTS, MESSAGE_EMAIL_WINDOW_MS } = await import("../lib/messaging");
    const { processEmailOutboxBatch, AGE_LIMITED_TEMPLATES, NOTIFICATION_MAX_AGE_MS } = await import("../lib/email-outbox-worker");
    const { EMAIL_TEMPLATES, buildTransactionalEmail } = await import("../lib/email-templates");
    const { stableEmailDedupeKey } = await import("../lib/email-outbox-core");

    // Start each run inside a fresh 15-minute window, so "same window" below cannot cross a boundary by accident.
    const windowStart = (Math.floor(Date.now() / MESSAGE_EMAIL_WINDOW_MS) + 1) * MESSAGE_EMAIL_WINDOW_MS;
    let clock = windowStart + 1_000;
    const ctx = () => ({
      settings: { enabled: true, allowContactDetails: false, limits: { ...MESSAGING_LIMIT_DEFAULTS } },
      rateLimit: async () => true,
      appBaseUrl: "https://shop.example.invalid",
      now: () => new Date(clock),
    });

    type Delivery = { template: string; recipient: string; messageId: string; text: string; html: string };
    const deliveries: Delivery[] = [];
    const fakeTransport = async (template: string, payload: Record<string, string | number | boolean | null>, recipient: string, messageId: string) => {
      const mail = buildTransactionalEmail(template as never, payload, "BAGATI <no-reply@shop.example.invalid>", recipient, messageId);
      deliveries.push({ template, recipient, messageId, text: String(mail.text ?? ""), html: String(mail.html ?? "") });
    };
    const deps = { prisma, assertSmtpConfigured: () => undefined, sendTransactionalEmail: fakeTransport as never };
    const mine = () => prisma.emailOutbox.findMany({ where: { recipient: { contains: tag } }, orderBy: { createdAt: "asc" } });
    // Run the real batch once per pending row of THIS test only. availableAt is stored with millisecond precision and
    // PostgreSQL rounds it, so a row created in the same millisecond can sit just after the batch's "now"; a few ms of
    // wait keeps the test deterministic (in production such a row simply goes out on the next 30 s tick).
    const drainMine = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      for (const row of await prisma.emailOutbox.findMany({ where: { recipient: { contains: tag }, status: "PENDING" }, select: { id: true } })) {
        await processEmailOutboxBatch(25, deps, row.id);
      }
    };

    // Fixtures: one city, one store (seller account e-mail, no notification address), one customer.
    const city = await prisma.city.create({ data: { name: `Şəhər ${tag}`, slug: `${tag}-city`, isActive: true } });
    const customer = await prisma.user.create({ data: { id: `${tag}_c`, email: `${tag}-c@verify.invalid`, passwordHash: "x", role: "CUSTOMER" } });
    const seller = await prisma.user.create({ data: { id: `${tag}_s`, email: `${tag}-s@verify.invalid`, passwordHash: "x", role: "VENDOR" } });
    const vendor = await prisma.vendorProfile.create({ data: { userId: seller.id, displayName: `Satıcı ${tag}`, sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: "Satıcı", voen: `8${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}1`, legalAddress: "Ünvan" } });
    const store = await prisma.store.create({ data: { vendorId: vendor.id, cityId: city.id, name: `Mağaza ${tag}`, slug: `${tag}-store`, status: "ACTIVE", isActive: true, legalInfoApproved: true, adminManaged: true } });
    const C = { role: "CUSTOMER" as const, userId: customer.id };
    const S = { role: "STORE" as const, userId: seller.id, storeId: store.id };
    const SECRET_TEXT = `gizli-mətn-${tag}`;

    await t.test("both templates are known to the worker and age-limited", () => {
      for (const template of ["MESSAGE_TO_STORE", "MESSAGE_TO_CUSTOMER"]) {
        assert.ok((EMAIL_TEMPLATES as readonly string[]).includes(template), `${template} is in EMAIL_TEMPLATES`);
        assert.ok(AGE_LIMITED_TEMPLATES.has(template), `${template} is age-limited`);
      }
      assert.equal(NOTIFICATION_MAX_AGE_MS, 24 * 60 * 60 * 1000);
    });

    let threadId = "";
    await t.test("customer writes twice in one window: one MESSAGE_TO_STORE row, sent once, link-only", async () => {
      const started = await service.startConversation(prisma, { customerId: C.userId, storeId: store.id, context: "STORE", body: `Salam ${SECRET_TEXT}` }, ctx());
      threadId = started.conversationId;
      clock += 60_000;
      await service.sendMessage(prisma, { conversationId: threadId, actor: C, body: `Yenə ${SECRET_TEXT}` }, ctx());
      const rows = await mine();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].template, "MESSAGE_TO_STORE");
      assert.equal(rows[0].recipient, seller.email, "no notification address: the seller account e-mail");
      assert.equal(rows[0].dedupeKey, stableEmailDedupeKey(`message:${threadId}:STORE:${Math.floor(windowStart / MESSAGE_EMAIL_WINDOW_MS)}`));
      await drainMine();
      const [row] = await mine();
      assert.equal(row.status, "SENT");
      assert.equal(row.attempts, 1);
      assert.equal(deliveries.length, 1);
      const [mail] = deliveries;
      assert.equal(mail.template, "MESSAGE_TO_STORE");
      assert.equal(mail.messageId, row.dedupeKey, "the worker hands the outbox dedupe key to the transport (the SMTP Message-ID is derived from it)");
      assert.ok(mail.text.includes(`https://shop.example.invalid/vendor/${store.id}/messages/${threadId}`), "deep link to the seller thread");
      assert.ok(!mail.text.includes(SECRET_TEXT) && !mail.html.includes(SECRET_TEXT), "the message text never goes into the e-mail");
    });

    await t.test("a third message in the same window after the e-mail went out: no new row, no second send", async () => {
      clock += 60_000;
      await service.sendMessage(prisma, { conversationId: threadId, actor: C, body: "Üçüncü" }, ctx());
      await drainMine();
      assert.equal((await mine()).length, 1);
      assert.equal(deliveries.length, 1);
    });

    await t.test("store reply: one MESSAGE_TO_CUSTOMER row, sent once, link to the customer's thread", async () => {
      await service.sendMessage(prisma, { conversationId: threadId, actor: S, body: `Cavab ${SECRET_TEXT}` }, ctx());
      await service.sendMessage(prisma, { conversationId: threadId, actor: S, body: "Daha bir cavab" }, ctx());
      await drainMine();
      const rows = (await mine()).filter((row) => row.template === "MESSAGE_TO_CUSTOMER");
      assert.equal(rows.length, 1);
      assert.equal(rows[0].recipient, customer.email);
      assert.equal(rows[0].status, "SENT");
      const mail = deliveries.at(-1)!;
      assert.equal(deliveries.length, 2);
      assert.equal(mail.template, "MESSAGE_TO_CUSTOMER");
      assert.ok(mail.text.includes(`https://shop.example.invalid/account/messages/${threadId}`));
      assert.ok(!mail.text.includes(SECRET_TEXT) && !mail.html.includes(SECRET_TEXT));
    });

    await t.test("next 15-minute window: one more e-mail to the store", async () => {
      clock = windowStart + MESSAGE_EMAIL_WINDOW_MS + 1_000;
      await service.sendMessage(prisma, { conversationId: threadId, actor: C, body: "Növbəti pəncərə" }, ctx());
      await drainMine();
      const store = (await mine()).filter((row) => row.template === "MESSAGE_TO_STORE");
      assert.equal(store.length, 2);
      assert.ok(store.every((row) => row.status === "SENT" && row.attempts === 1));
      assert.equal(deliveries.length, 3);
      assert.equal(new Set(deliveries.map((d) => d.messageId)).size, 3, "no duplicate sends");
    });

    await t.test("24 h staleness: a row older than 24 h is FAILED NOTIFICATION_STALE and never sent; 23 h is still sent", async () => {
      clock = windowStart + 2 * MESSAGE_EMAIL_WINDOW_MS + 1_000;
      await service.sendMessage(prisma, { conversationId: threadId, actor: S, body: "Köhnə bildiriş" }, ctx());
      clock = windowStart + 3 * MESSAGE_EMAIL_WINDOW_MS + 1_000;
      await service.sendMessage(prisma, { conversationId: threadId, actor: C, body: "Təzə bildiriş" }, ctx());
      const pending = await prisma.emailOutbox.findMany({ where: { recipient: { contains: tag }, status: "PENDING" } });
      assert.equal(pending.length, 2);
      const old = pending.find((row) => row.template === "MESSAGE_TO_CUSTOMER")!;
      const recent = pending.find((row) => row.template === "MESSAGE_TO_STORE")!;
      await prisma.emailOutbox.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - NOTIFICATION_MAX_AGE_MS - 60_000) } });
      await prisma.emailOutbox.update({ where: { id: recent.id }, data: { createdAt: new Date(Date.now() - 23 * 60 * 60 * 1000) } });
      const before = deliveries.length;
      await drainMine();
      const staleRow = await prisma.emailOutbox.findUniqueOrThrow({ where: { id: old.id } });
      assert.equal(staleRow.status, "FAILED");
      assert.equal(staleRow.lastErrorCode, "NOTIFICATION_STALE");
      assert.equal(staleRow.failureCategory, "MESSAGE_REJECTED");
      assert.equal(staleRow.retrySafe, false, "never retried");
      assert.equal((await prisma.emailOutbox.findUniqueOrThrow({ where: { id: recent.id } })).status, "SENT");
      assert.equal(deliveries.length, before + 1, "only the 23 h row was delivered");
      assert.ok(!deliveries.slice(before).some((d) => d.messageId === old.dedupeKey));
    });
  } finally {
    await prisma.emailOutbox.deleteMany({ where: { recipient: { contains: tag } } }).catch(() => undefined);
    await prisma.notification.deleteMany({ where: { userId: { startsWith: tag } } }).catch(() => undefined);
    await prisma.conversation.deleteMany({ where: { customerId: { startsWith: tag } } }).catch(() => undefined);
    await prisma.store.deleteMany({ where: { slug: { startsWith: tag } } }).catch(() => undefined);
    await prisma.vendorProfile.deleteMany({ where: { userId: { startsWith: tag } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { startsWith: tag } } }).catch(() => undefined);
    await prisma.city.deleteMany({ where: { slug: { startsWith: tag } } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
