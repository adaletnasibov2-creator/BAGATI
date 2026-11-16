/**
 * Customer <-> store messaging service on real PostgreSQL (phase 4).
 *
 * Safety: uses only BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL (loopback, port 5433, database name containing "verify")
 * and REQUIRES BAGATI_VERIFY_SCHEMA = a cat_* scratch schema with all migrations including
 * 20261117010000_customer_store_messaging. Creates its own rows (random tag) and deletes them at the end. E-mails are
 * only queued in that schema's EmailOutbox (no worker runs). Skips (NOT VERIFIED) when the cluster, schema or tables
 * are missing.
 *
 *   BAGATI_VERIFY_SCHEMA=cat_messaging npx tsx --test scripts/messaging.integration.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";

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

test("customer <-> store messaging service on PostgreSQL", { timeout: 240_000 }, async (t) => {
  const guard = guardedScratchUrl();
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  // The real rate limiter and the outbox use the global client from lib/prisma: point it at the scratch schema first.
  process.env.DATABASE_URL = guard.url;
  process.env.SESSION_SECRET ||= "messaging-integration-test-secret-0123456789abcdef";
  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  const tag = `it${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const limiterKeys: string[] = [];
  try {
    try { await prisma.$queryRaw`SELECT 1`; } catch { return t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable"); }
    const [where] = await prisma.$queryRaw<{ db: string; port: number; schema: string }[]>`SELECT current_database() AS db, inet_server_port() AS port, current_schema() AS schema`;
    assert.ok(where.db.includes("verify") && Number(where.port) === 5433 && where.schema.startsWith("cat_"));
    const migrated = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'Conversation'`;
    if (!migrated[0]?.n) return t.skip("NOT VERIFIED: scratch schema lacks the messaging tables (this test never migrates)");

    const service = await import("../lib/messaging-service");
    const { authRateLimitKey, clearAuthRateLimit } = await import("../lib/auth-rate-limit");
    const { MESSAGING_LIMIT_DEFAULTS, MESSAGE_EMAIL_WINDOW_MS } = await import("../lib/messaging");
    const allow = async () => true;
    const settings = (overrides: Partial<{ enabled: boolean; allowContactDetails: boolean }> = {}, limits = {}) => ({
      settings: { enabled: true, allowContactDetails: false, limits: { ...MESSAGING_LIMIT_DEFAULTS, ...limits }, ...overrides },
      rateLimit: allow,
      appBaseUrl: "https://shop.example.invalid",
    });
    const ON = settings();
    const codeOf = (error: unknown) => (error as { code?: string })?.code;

    // Fixtures: one city, two eligible stores, two customers, one product per store, one order of customer A at store 1.
    const city = await prisma.city.create({ data: { name: `Şəhər ${tag}`, slug: `${tag}-city`, isActive: true } });
    const mkUser = (suffix: string, role: "CUSTOMER" | "VENDOR") => prisma.user.create({ data: { id: `${tag}_${suffix}`, email: `${tag}-${suffix}@verify.invalid`, passwordHash: "x", role } });
    const [customerA, customerB, customerC, seller1, seller2] = await Promise.all([mkUser("ca", "CUSTOMER"), mkUser("cb", "CUSTOMER"), mkUser("cc", "CUSTOMER"), mkUser("s1", "VENDOR"), mkUser("s2", "VENDOR")]);
    await prisma.customerProfile.create({ data: { userId: customerA.id, firstName: "Aysel", lastName: "Məmmədova", phone: "+994501234567" } });
    const mkStore = async (n: number, sellerId: string) => {
      const vendor = await prisma.vendorProfile.create({ data: { userId: sellerId, displayName: `Satıcı ${n} ${tag}`, sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: `Satıcı ${n}`, voen: `9${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}${n}`, legalAddress: "Ünvan" } });
      return prisma.store.create({ data: { vendorId: vendor.id, cityId: city.id, name: `Mağaza ${n} ${tag}`, slug: `${tag}-store-${n}`, status: "ACTIVE", isActive: true, legalInfoApproved: true, adminManaged: true } });
    };
    const store1 = await mkStore(1, seller1.id);
    const store2 = await mkStore(2, seller2.id);
    const product1 = await prisma.product.create({ data: { storeId: store1.id, name: `Vaza ${tag}`, slug: `${tag}-p1`, price: new Prisma.Decimal(10), status: "ACTIVE" } });
    const product2 = await prisma.product.create({ data: { storeId: store2.id, name: `Lampa ${tag}`, slug: `${tag}-p2`, price: new Prisma.Decimal(10), status: "ACTIVE" } });
    const order = await prisma.order.create({ data: { userId: customerA.id, status: "PENDING", subtotal: new Prisma.Decimal(10), total: new Prisma.Decimal(10), addressSnapshot: {}, storeOrders: { create: { storeId: store1.id, status: "NEW", subtotal: new Prisma.Decimal(10) } } }, include: { storeOrders: true } });
    const storeOrderId = order.storeOrders[0].id;
    const A = { role: "CUSTOMER" as const, userId: customerA.id };
    const B = { role: "CUSTOMER" as const, userId: customerB.id };
    const S1 = { role: "STORE" as const, userId: seller1.id, storeId: store1.id };
    const S2 = { role: "STORE" as const, userId: seller2.id, storeId: store2.id };
    const conversationRow = (id: string) => prisma.conversation.findUniqueOrThrow({ where: { id } });
    const outbox = (template: string) => prisma.emailOutbox.count({ where: { template, recipient: { contains: tag } } });

    await t.test("switch OFF: nothing can be started or sent", async () => {
      await assert.rejects(service.startConversation(prisma, { customerId: A.userId, storeId: store1.id, context: "STORE", body: "Salam" }, settings({ enabled: false })), (e) => codeOf(e) === "DISABLED");
      assert.equal(await prisma.conversation.count({ where: { customerId: A.userId } }), 0);
    });

    let storeThread = "";
    await t.test("start (store context): thread, message, counters, link-only e-mail to the seller account (no notification address)", async () => {
      const started = await service.startConversation(prisma, { customerId: A.userId, storeId: store1.id, context: "STORE", body: "  Salam!\r\n\r\n\r\nSualım var.  " }, ON);
      assert.equal(started.created, true);
      storeThread = started.conversationId;
      const row = await conversationRow(storeThread);
      assert.equal(row.contextKey, "store");
      assert.equal(row.storeUnreadCount, 1);
      assert.equal(row.customerUnreadCount, 0);
      assert.equal(row.lastSenderRole, "CUSTOMER");
      assert.equal(row.lastMessagePreview, "Salam! Sualım var.");
      const message = await prisma.conversationMessage.findUniqueOrThrow({ where: { id: started.messageId } });
      assert.equal(message.body, "Salam!\n\nSualım var.");
      const email = await prisma.emailOutbox.findFirstOrThrow({ where: { template: "MESSAGE_TO_STORE", recipient: seller1.email } });
      assert.ok(email, "store has no contactEmail: falls back to the seller account e-mail");
      // Same context again: same thread, no second conversation.
      const again = await service.startConversation(prisma, { customerId: A.userId, storeId: store1.id, context: "STORE", body: "Bir sual da" }, ON);
      assert.equal(again.created, false);
      assert.equal(again.conversationId, storeThread);
      assert.equal((await conversationRow(storeThread)).storeUnreadCount, 2);
      assert.equal(await outbox("MESSAGE_TO_STORE"), 1, "second message within 15 minutes: no second e-mail");
    });

    await t.test("store reply: counters swap, customer gets one link-only e-mail; store notification address is used when set", async () => {
      await service.sendMessage(prisma, { conversationId: storeThread, actor: S1, body: "Buyurun, sualınızı yazın." }, ON);
      const row = await conversationRow(storeThread);
      assert.equal(row.customerUnreadCount, 1);
      assert.equal(row.storeUnreadCount, 0, "replying means the store has read the thread");
      assert.equal(row.lastSenderRole, "STORE");
      assert.equal(await prisma.emailOutbox.count({ where: { template: "MESSAGE_TO_CUSTOMER", recipient: customerA.email } }), 1);
      await prisma.store.update({ where: { id: store1.id }, data: { contactEmail: `${tag}-notify@verify.invalid` } });
      // A separate thread (customer C), so the shifted clock does not reorder storeThread's messages.
      const C = { role: "CUSTOMER" as const, userId: customerC.id };
      const own = await service.startConversation(prisma, { customerId: C.userId, storeId: store1.id, context: "STORE", body: "Salam" }, ON);
      await service.sendMessage(prisma, { conversationId: own.conversationId, actor: C, body: "Yenə mən" }, ON);
      assert.equal(await prisma.emailOutbox.count({ where: { template: "MESSAGE_TO_STORE", recipient: `${tag}-notify@verify.invalid` } }), 1, "notification address, one e-mail in this window");
      const later = { ...ON, now: () => new Date(Date.now() + MESSAGE_EMAIL_WINDOW_MS) };
      await service.sendMessage(prisma, { conversationId: own.conversationId, actor: C, body: "Təşəkkürlər" }, later);
      assert.equal(await prisma.emailOutbox.count({ where: { template: "MESSAGE_TO_STORE", recipient: `${tag}-notify@verify.invalid` } }), 2, "next window: one more e-mail");
    });

    await t.test("contexts: only this store's active product; only the customer's own store order", async () => {
      const product = await service.startConversation(prisma, { customerId: A.userId, storeId: store1.id, context: "PRODUCT", contextId: product1.id, body: "Bu vazanın ölçüsü?" }, ON);
      assert.equal((await conversationRow(product.conversationId)).contextKey, `product:${product1.id}`);
      await assert.rejects(service.startConversation(prisma, { customerId: A.userId, storeId: store1.id, context: "PRODUCT", contextId: product2.id, body: "x" }, ON), (e) => codeOf(e) === "CONTEXT_INVALID");
      const own = await service.startConversation(prisma, { customerId: A.userId, storeId: store1.id, context: "ORDER", contextId: storeOrderId, body: "Sifariş nə vaxt gələcək?" }, ON);
      assert.equal((await conversationRow(own.conversationId)).storeOrderId, storeOrderId);
      await assert.rejects(service.startConversation(prisma, { customerId: B.userId, storeId: store1.id, context: "ORDER", contextId: storeOrderId, body: "x" }, ON), (e) => codeOf(e) === "CONTEXT_INVALID");
      await assert.rejects(service.startConversation(prisma, { customerId: A.userId, storeId: store2.id, context: "ORDER", contextId: storeOrderId, body: "x" }, ON), (e) => codeOf(e) === "CONTEXT_INVALID");
      await assert.rejects(service.startConversation(prisma, { customerId: A.userId, storeId: store1.id, context: "PRODUCT", contextId: "bad id", body: "x" }, ON), (e) => codeOf(e) === "CONTEXT_INVALID");
      // A seller account cannot start a conversation (only customers start; the store replies).
      await assert.rejects(service.startConversation(prisma, { customerId: seller1.id, storeId: store2.id, context: "STORE", body: "x" }, ON), (e) => codeOf(e) === "NOT_FOUND");
    });

    await t.test("ownership: other customers and other stores see nothing and can do nothing", async () => {
      for (const actor of [B, S2]) {
        await assert.rejects(service.sendMessage(prisma, { conversationId: storeThread, actor, body: "x" }, ON), (e) => codeOf(e) === "NOT_FOUND");
        await assert.rejects(service.listMessages(prisma, { conversationId: storeThread, actor }), (e) => codeOf(e) === "NOT_FOUND");
        await assert.rejects(service.markConversationRead(prisma, { conversationId: storeThread, actor }), (e) => codeOf(e) === "NOT_FOUND");
        await assert.rejects(service.reportConversation(prisma, { conversationId: storeThread, actor, reason: "SPAM" }), (e) => codeOf(e) === "NOT_FOUND");
        await assert.rejects(service.blockCounterpart(prisma, { conversationId: storeThread, actor }), (e) => codeOf(e) === "NOT_FOUND");
      }
      assert.equal((await service.listConversations(prisma, { actor: B })).items.length, 0);
      assert.equal((await service.listConversations(prisma, { actor: S2 })).items.length, 0);
    });

    await t.test("contact details: refused by default, allowed by the setting", async () => {
      await assert.rejects(service.sendMessage(prisma, { conversationId: storeThread, actor: A, body: "Zəng edin 050 123 45 67" }, ON), (e) => codeOf(e) === "INVALID_BODY");
      await assert.rejects(service.sendMessage(prisma, { conversationId: storeThread, actor: S1, body: "Yazın: satis@example.az" }, ON), (e) => codeOf(e) === "INVALID_BODY");
      await service.sendMessage(prisma, { conversationId: storeThread, actor: A, body: "Zəng edin 050 123 45 67" }, settings({ allowContactDetails: true }));
    });

    await t.test("lists: newest first, cursor pages, display name only (no e-mail or phone)", async () => {
      const page1 = await service.listConversations(prisma, { actor: S1, limit: 2 });
      assert.equal(page1.items.length, 2);
      assert.ok(page1.nextCursor);
      const page2 = await service.listConversations(prisma, { actor: S1, limit: 2, cursor: page1.nextCursor });
      assert.equal(page2.nextCursor, null, "last page");
      const all = [...page1.items, ...page2.items];
      // Store 1 has A's store, product and order threads and C's store thread.
      assert.equal(new Set(all.map((item) => item.id)).size, 4, "four threads, no duplicates across pages");
      for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].lastMessageAt >= all[i].lastMessageAt, "newest activity first");
      assert.equal(all.filter((item) => item.counterpart === "Aysel M.").length, 3);
      assert.equal(all.filter((item) => item.counterpart === "Müştəri").length, 1, "no profile name: fallback, never the e-mail");
      const serialized = JSON.stringify(all);
      assert.ok(!serialized.includes("@") && !serialized.includes("+994"), "no e-mail or phone in the store's list");
      assert.equal((await service.listConversations(prisma, { actor: A })).items[0].counterpart, store1.name);
      const messages = await service.listMessages(prisma, { conversationId: storeThread, actor: S1, limit: 2 });
      assert.equal(messages.items.length, 2);
      assert.equal(messages.hasOlder, true);
      const older = await service.listMessages(prisma, { conversationId: storeThread, actor: S1, before: messages.items[0].id, limit: 10 });
      assert.ok(older.items.length >= 2 && older.items.every((m) => m.createdAt <= messages.items[0].createdAt));
      const newest = messages.items[messages.items.length - 1];
      assert.equal((await service.listMessages(prisma, { conversationId: storeThread, actor: A, after: newest.id })).items.length, 0, "poll: nothing new");
      await service.sendMessage(prisma, { conversationId: storeThread, actor: S1, body: "Yeni cavab" }, ON);
      const polled = await service.listMessages(prisma, { conversationId: storeThread, actor: A, after: newest.id });
      assert.deepEqual(polled.items.map((m) => m.body), ["Yeni cavab"]);
    });

    await t.test("read state and badges", async () => {
      assert.ok((await service.unreadConversationCount(prisma, A)) >= 1);
      await service.markConversationRead(prisma, { conversationId: storeThread, actor: A });
      const row = await conversationRow(storeThread);
      assert.equal(row.customerUnreadCount, 0);
      assert.ok(row.customerLastReadAt);
      assert.ok((await service.unreadConversationCount(prisma, S1)) >= 1, "product and order threads are unread for the store");
    });

    await t.test("block: blocks both directions for that store; each side lifts only its own block", async () => {
      await service.blockCounterpart(prisma, { conversationId: storeThread, actor: S1 });
      await service.blockCounterpart(prisma, { conversationId: storeThread, actor: S1 });
      assert.equal(await prisma.conversationBlock.count({ where: { storeId: store1.id, customerId: A.userId } }), 1, "idempotent");
      await assert.rejects(service.sendMessage(prisma, { conversationId: storeThread, actor: A, body: "salam" }, ON), (e) => codeOf(e) === "BLOCKED");
      await assert.rejects(service.sendMessage(prisma, { conversationId: storeThread, actor: S1, body: "salam" }, ON), (e) => codeOf(e) === "BLOCKED");
      await assert.rejects(service.startConversation(prisma, { customerId: A.userId, storeId: store1.id, context: "PRODUCT", contextId: product1.id, body: "salam" }, ON), (e) => codeOf(e) === "BLOCKED");
      assert.equal((await service.unblockCounterpart(prisma, { conversationId: storeThread, actor: A })).blocked, true, "the customer cannot lift the store's block");
      assert.equal((await service.unblockCounterpart(prisma, { conversationId: storeThread, actor: S1 })).blocked, false);
      await service.sendMessage(prisma, { conversationId: storeThread, actor: A, body: "Yenidən salam" }, ON);
    });

    await t.test("report: one open report per side; the store gets no notification about it", async () => {
      const notificationsBefore = await prisma.notification.count({ where: { userId: seller1.id } });
      const first = await service.reportConversation(prisma, { conversationId: storeThread, actor: A, reason: "SPAM", note: "Reklam göndərir" });
      const second = await service.reportConversation(prisma, { conversationId: storeThread, actor: A, reason: "ABUSE" });
      assert.equal(first.created, true);
      assert.equal(second.created, false);
      assert.equal(second.id, first.id);
      assert.equal((await service.reportConversation(prisma, { conversationId: storeThread, actor: S1, reason: "FRAUD" })).created, true, "the other side has its own report");
      await assert.rejects(service.reportConversation(prisma, { conversationId: storeThread, actor: A, reason: "NOT_A_REASON" }), (e) => codeOf(e) === "INVALID");
      assert.equal(await prisma.notification.count({ where: { userId: seller1.id } }), notificationsBefore);
    });

    await t.test("concurrency: 20 parallel customer messages give exactly 20 unread for the store", async () => {
      const thread = await service.startConversation(prisma, { customerId: B.userId, storeId: store2.id, context: "STORE", body: "Başlanğıc" }, ON);
      await service.markConversationRead(prisma, { conversationId: thread.conversationId, actor: S2 });
      await Promise.all(Array.from({ length: 20 }, (_, i) => service.sendMessage(prisma, { conversationId: thread.conversationId, actor: B, body: `Mesaj ${i}` }, ON)));
      assert.equal((await conversationRow(thread.conversationId)).storeUnreadCount, 20);
      assert.equal(await prisma.conversationMessage.count({ where: { conversationId: thread.conversationId } }), 21);
    });

    await t.test("concurrency: sends racing with mark-read keep the counter consistent with the messages", async () => {
      const thread = await service.startConversation(prisma, { customerId: B.userId, storeId: store2.id, context: "PRODUCT", contextId: product2.id, body: "Başlanğıc" }, ON);
      await Promise.all([
        ...Array.from({ length: 12 }, (_, i) => service.sendMessage(prisma, { conversationId: thread.conversationId, actor: B, body: `Yarış ${i}` }, ON)),
        ...Array.from({ length: 4 }, () => service.markConversationRead(prisma, { conversationId: thread.conversationId, actor: S2 })),
      ]);
      const row = await conversationRow(thread.conversationId);
      const unreadByMessages = await prisma.conversationMessage.count({ where: { conversationId: thread.conversationId, senderRole: "CUSTOMER", createdAt: { gt: row.storeLastReadAt ?? new Date(0) } } });
      assert.equal(row.storeUnreadCount, unreadByMessages, "counter = customer messages after the store's last read");
    });

    await t.test("concurrency: 5 parallel starts of the same context give one thread and 5 messages", async () => {
      const results = await Promise.all(Array.from({ length: 5 }, (_, i) => service.startConversation(prisma, { customerId: A.userId, storeId: store2.id, context: "PRODUCT", contextId: product2.id, body: `Paralel ${i}` }, ON)));
      assert.equal(new Set(results.map((r) => r.conversationId)).size, 1);
      assert.equal(results.filter((r) => r.created).length, 1);
      assert.equal(await prisma.conversationMessage.count({ where: { conversationId: results[0].conversationId } }), 5);
    });

    await t.test("rate limits (real limiter): per customer per hour and new conversations per day", async () => {
      const limited = { ...settings({}, { customerMessagesPerHour: 3, customerNewConversationsPerDay: 1 }), rateLimit: undefined };
      limiterKeys.push(`customer:${B.userId}`, `customer-new:${B.userId}`, `store-in:${store1.id}`, `store-in:${store2.id}`, `store-out:${store1.id}`);
      for (const key of limiterKeys) await clearAuthRateLimit(authRateLimitKey("messaging", key));
      const first = await service.startConversation(prisma, { customerId: B.userId, storeId: store1.id, context: "STORE", body: "1" }, limited);
      await assert.rejects(service.startConversation(prisma, { customerId: B.userId, storeId: store1.id, context: "PRODUCT", contextId: product1.id, body: "x" }, limited), (e) => codeOf(e) === "RATE_LIMITED", "second new conversation today");
      // The refused start stopped at its first (new-conversation) check, so it spent no message slot.
      await service.sendMessage(prisma, { conversationId: first.conversationId, actor: B, body: "2" }, limited);
      await service.sendMessage(prisma, { conversationId: first.conversationId, actor: B, body: "3" }, limited);
      await assert.rejects(service.sendMessage(prisma, { conversationId: first.conversationId, actor: B, body: "4" }, limited), (e) => codeOf(e) === "RATE_LIMITED", "fourth message this hour");
    });

    await t.test("store unavailable: the customer cannot write to a suspended store; the store can still reply", async () => {
      await prisma.store.update({ where: { id: store1.id }, data: { status: "SUSPENDED" } });
      await assert.rejects(service.sendMessage(prisma, { conversationId: storeThread, actor: A, body: "salam" }, ON), (e) => codeOf(e) === "STORE_UNAVAILABLE");
      await assert.rejects(service.startConversation(prisma, { customerId: A.userId, storeId: store1.id, context: "PRODUCT", contextId: product1.id, body: "salam" }, ON), (e) => codeOf(e) === "STORE_UNAVAILABLE");
      await service.sendMessage(prisma, { conversationId: storeThread, actor: S1, body: "Mağaza müvəqqəti bağlıdır." }, ON);
      await prisma.store.update({ where: { id: store1.id }, data: { status: "ACTIVE" } });
    });

    await t.test("account deletion: deleteCustomerConversations keeps only conversations with an OPEN report; they become admin-only orphans", async () => {
      const own = await prisma.conversation.findMany({ where: { customerId: customerA.id }, select: { id: true, reports: { select: { status: true } } } });
      assert.ok(own.length >= 3);
      // Make the case explicit: one thread with an OPEN report, one with only a REVIEWED report, the rest unreported.
      const [reported, reviewed] = own.filter((row) => row.id !== storeThread).slice(0, 2).map((row) => row.id);
      await prisma.conversationReport.deleteMany({ where: { conversationId: { in: own.map((row) => row.id) } } });
      await prisma.conversationReport.create({ data: { conversationId: reported, reporterUserId: seller1.id, reporterRole: "STORE", reason: "ABUSE" } });
      await prisma.conversationReport.create({ data: { conversationId: reviewed, reporterUserId: seller1.id, reporterRole: "STORE", reason: "SPAM", status: "REVIEWED" } });
      await prisma.conversation.update({ where: { id: reported }, data: { storeUnreadCount: 3 } });
      const reportedMessages = await prisma.conversationMessage.count({ where: { conversationId: reported } });
      assert.ok(reportedMessages > 0);
      await prisma.conversationBlock.upsert({ where: { storeId_customerId_side: { storeId: store1.id, customerId: customerA.id, side: "STORE" } }, create: { storeId: store1.id, customerId: customerA.id, side: "STORE", createdById: seller1.id }, update: {} });

      const result = await prisma.$transaction(async (tx) => {
        const cleared = await service.deleteCustomerConversations(tx, customerA.id);
        await tx.order.deleteMany({ where: { userId: customerA.id } });
        await tx.user.delete({ where: { id: customerA.id } });
        return cleared;
      });
      assert.deepEqual(result, { deleted: own.length - 1, kept: 1 });
      // Kept: the OPEN-reported thread, with messages and report, customer link cleared.
      const orphan = await prisma.conversation.findUniqueOrThrow({ where: { id: reported } });
      assert.equal(orphan.customerId, null);
      assert.equal(await prisma.conversationMessage.count({ where: { conversationId: reported } }), reportedMessages);
      assert.equal(await prisma.conversationReport.count({ where: { conversationId: reported, status: "OPEN" } }), 1);
      // Gone: everything else (a REVIEWED report does not keep a thread), and the blocks.
      for (const id of own.map((row) => row.id).filter((id) => id !== reported)) {
        assert.equal(await prisma.conversation.count({ where: { id } }), 0, id);
        assert.equal(await prisma.conversationMessage.count({ where: { conversationId: id } }), 0, id);
      }
      assert.equal(await prisma.conversationBlock.count({ where: { customerId: customerA.id } }), 0);

      // The orphan is invisible to the store everywhere: list, badge, view, messages/polling, send, read, block, report.
      const list = await service.listConversations(prisma, { actor: S1, limit: 50 });
      assert.ok(!list.items.some((item) => item.id === reported), "not in the store's list");
      const badge = await service.unreadConversationCount(prisma, S1);
      assert.equal(badge, await prisma.conversation.count({ where: { storeId: store1.id, customerId: { not: null }, storeUnreadCount: { gt: 0 } } }), "badge ignores the orphan's unread count");
      const { getConversationView } = await import("../lib/messaging-views");
      assert.equal(await getConversationView(prisma, { conversationId: reported, actor: S1 }), null);
      await assert.rejects(service.listMessages(prisma, { conversationId: reported, actor: S1 }), (e) => codeOf(e) === "NOT_FOUND");
      await assert.rejects(service.sendMessage(prisma, { conversationId: reported, actor: S1, body: "salam" }, ON), (e) => codeOf(e) === "NOT_FOUND");
      await assert.rejects(service.markConversationRead(prisma, { conversationId: reported, actor: S1 }), (e) => codeOf(e) === "NOT_FOUND");
      await assert.rejects(service.blockCounterpart(prisma, { conversationId: reported, actor: S1 }), (e) => codeOf(e) === "NOT_FOUND");
      await assert.rejects(service.reportConversation(prisma, { conversationId: reported, actor: S1, reason: "SPAM" }), (e) => codeOf(e) === "NOT_FOUND");
      assert.equal(await prisma.conversationMessage.count({ where: { conversationId: reported } }), reportedMessages, "nothing was added");
    });

    await t.test("a user deleted WITHOUT the helper keeps all their conversations as orphans (nothing is lost)", async () => {
      const ids = (await prisma.conversation.findMany({ where: { customerId: customerC.id }, select: { id: true } })).map((row) => row.id);
      assert.ok(ids.length >= 1);
      await prisma.order.deleteMany({ where: { userId: customerC.id } });
      await prisma.user.delete({ where: { id: customerC.id } });
      const after = await prisma.conversation.findMany({ where: { id: { in: ids } }, select: { customerId: true } });
      assert.equal(after.length, ids.length, "every conversation is kept");
      assert.ok(after.every((row) => row.customerId === null), "and is now an admin-only orphan");
    });
  } finally {
    const { authRateLimitKey, clearAuthRateLimit } = await import("../lib/auth-rate-limit").catch(() => ({ authRateLimitKey: null, clearAuthRateLimit: null }) as never);
    if (authRateLimitKey && clearAuthRateLimit) for (const key of limiterKeys) await clearAuthRateLimit(authRateLimitKey("messaging", key)).catch(() => undefined);
    await prisma.emailOutbox.deleteMany({ where: { recipient: { contains: tag } } }).catch(() => undefined);
    await prisma.notification.deleteMany({ where: { userId: { startsWith: tag } } }).catch(() => undefined);
    await prisma.order.deleteMany({ where: { userId: { startsWith: tag } } }).catch(() => undefined);
    await prisma.conversation.deleteMany({ where: { customerId: { startsWith: tag } } }).catch(() => undefined);
    await prisma.product.deleteMany({ where: { slug: { startsWith: tag } } }).catch(() => undefined);
    await prisma.store.deleteMany({ where: { slug: { startsWith: tag } } }).catch(() => undefined);
    await prisma.vendorProfile.deleteMany({ where: { userId: { startsWith: tag } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { startsWith: tag } } }).catch(() => undefined);
    await prisma.city.deleteMany({ where: { slug: { startsWith: tag } } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
