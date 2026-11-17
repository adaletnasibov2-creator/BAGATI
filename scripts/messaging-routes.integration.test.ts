/**
 * Messaging routes (phase 5 customer, phase 6 seller) on real PostgreSQL: the real route pipeline
 * (runMessagingRoute: same-origin check -> actor -> messaging switch -> action) and the real actions, with test actors
 * in place of the cookie session (requireRole / requireStoreAccess need a request; they are pinned by the static test
 * scripts/messaging-routes.test.ts). Also the page read models (lib/messaging-views.ts).
 *
 * Safety: uses only BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL (loopback, port 5433, database name containing "verify")
 * and REQUIRES BAGATI_VERIFY_SCHEMA = a migrated cat_* scratch schema. Creates its own rows (random tag) and removes
 * them at the end, including the messaging.enabled setting row it writes. Skips (NOT VERIFIED) when unavailable.
 *
 *   BAGATI_VERIFY_SCHEMA=cat_messaging npx tsx --test scripts/messaging-routes.integration.test.ts
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

const ORIGIN = "https://shop.example.invalid";

test("messaging routes and page read models on PostgreSQL", { timeout: 240_000 }, async (t) => {
  const guard = guardedScratchUrl();
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  // lib/prisma (used by the actions, the settings read and the rate limiter) must point at the scratch schema first.
  process.env.DATABASE_URL = guard.url;
  process.env.SESSION_SECRET ||= "messaging-integration-test-secret-0123456789abcdef";
  process.env.APP_BASE_URL = ORIGIN;
  process.env.APP_URL = ORIGIN;
  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  const tag = `rt${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  let settingWritten = false;
  const limiterIdentities: string[] = [];
  try {
    try { await prisma.$queryRaw`SELECT 1`; } catch { return t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable"); }
    const [where] = await prisma.$queryRaw<{ db: string; port: number; schema: string }[]>`SELECT current_database() AS db, inet_server_port() AS port, current_schema() AS schema`;
    assert.ok(where.db.includes("verify") && Number(where.port) === 5433 && where.schema.startsWith("cat_"));
    const migrated = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'Conversation'`;
    if (!migrated[0]?.n) return t.skip("NOT VERIFIED: scratch schema lacks the messaging tables (this test never migrates)");
    if (await prisma.siteSetting.findUnique({ where: { key: "messaging.enabled" } })) throw new Error("Refusing to run: the scratch schema already has a messaging.enabled row.");

    const routes = await import("../lib/messaging-routes");
    const views = await import("../lib/messaging-views");
    const { invalidateSettingsCache } = await import("../lib/settings/read");

    // Fixtures: two eligible stores (one seller each), customers A and B, products, one store order of A at store 1.
    const city = await prisma.city.create({ data: { name: `Şəhər ${tag}`, slug: `${tag}-city`, isActive: true } });
    const mkUser = (suffix: string, role: "CUSTOMER" | "VENDOR") => prisma.user.create({ data: { id: `${tag}_${suffix}`, email: `${tag}-${suffix}@verify.invalid`, passwordHash: "x", role } });
    const [customerA, customerB, seller1, seller2] = await Promise.all([mkUser("ca", "CUSTOMER"), mkUser("cb", "CUSTOMER"), mkUser("s1", "VENDOR"), mkUser("s2", "VENDOR")]);
    await prisma.customerProfile.create({ data: { userId: customerA.id, firstName: "Aysel", lastName: "Məmmədova", phone: "+994501234567" } });
    const mkStore = async (n: number, sellerId: string, active = true) => {
      const vendor = await prisma.vendorProfile.create({ data: { userId: sellerId, displayName: `Satıcı ${n} ${tag}`, sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: `Satıcı ${n}`, voen: `8${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}${n}`, legalAddress: "Ünvan" } });
      return prisma.store.create({ data: { vendorId: vendor.id, cityId: city.id, name: `Mağaza ${n} ${tag}`, slug: `${tag}-store-${n}`, status: active ? "ACTIVE" : "SUSPENDED", isActive: active, legalInfoApproved: true, adminManaged: true } });
    };
    const store1 = await mkStore(1, seller1.id);
    const store2 = await mkStore(2, seller2.id);
    const product1 = await prisma.product.create({ data: { storeId: store1.id, name: `Vaza ${tag}`, slug: `${tag}-p1`, price: new Prisma.Decimal(10), status: "ACTIVE" } });
    const product2 = await prisma.product.create({ data: { storeId: store2.id, name: `Lampa ${tag}`, slug: `${tag}-p2`, price: new Prisma.Decimal(10), status: "ACTIVE" } });
    const order = await prisma.order.create({ data: { userId: customerA.id, status: "PENDING", subtotal: new Prisma.Decimal(10), total: new Prisma.Decimal(10), addressSnapshot: {}, storeOrders: { create: { storeId: store1.id, status: "NEW", subtotal: new Prisma.Decimal(10) } } }, include: { storeOrders: true } });
    const storeOrderId = order.storeOrders[0].id;
    limiterIdentities.push(`customer:${customerA.id}`, `customer-new:${customerA.id}`, `customer:${customerB.id}`, `customer-new:${customerB.id}`, `store-in:${store1.id}`, `store-in:${store2.id}`, `store-out:${store1.id}`, `store-out:${store2.id}`);

    type Actor = { role: "CUSTOMER"; userId: string } | { role: "STORE"; userId: string; storeId: string };
    const A: Actor = { role: "CUSTOMER", userId: customerA.id };
    const B: Actor = { role: "CUSTOMER", userId: customerB.id };
    const S1: Actor = { role: "STORE", userId: seller1.id, storeId: store1.id };
    const S2: Actor = { role: "STORE", userId: seller2.id, storeId: store2.id };
    let resolverCalls = 0;
    const as = (actor: Actor) => async () => { resolverCalls += 1; return { actor }; };
    type Action = Parameters<typeof routes.runMessagingRoute>[3];
    const call = async (actor: Actor, action: Action, input: { method?: string; path?: string; params?: Record<string, string>; body?: unknown; rawBody?: string; contentType?: string; origin?: string } = {}) => {
      const method = input.method ?? (input.body !== undefined || input.rawBody !== undefined ? "POST" : "GET");
      const headers: Record<string, string> = { origin: input.origin ?? ORIGIN, host: "shop.example.invalid" };
      if (input.body !== undefined || input.rawBody !== undefined) headers["content-type"] = input.contentType ?? "application/json";
      const request = new Request(`${ORIGIN}${input.path ?? "/api/x"}`, { method, headers, body: input.rawBody ?? (input.body === undefined ? undefined : JSON.stringify(input.body)) });
      const response = await routes.runMessagingRoute(request, { params: Promise.resolve(input.params ?? {}) }, as(actor), action, { write: method !== "GET" });
      const text = await response.text();
      return { status: response.status, json: text ? JSON.parse(text) as Record<string, any> : null, text };
    };
    const enableMessaging = async (value: boolean | null) => {
      if (value === null) await prisma.siteSetting.deleteMany({ where: { key: "messaging.enabled" } });
      else await prisma.siteSetting.upsert({ where: { key: "messaging.enabled" }, create: { key: "messaging.enabled", value }, update: { value } });
      settingWritten = true;
      invalidateSettingsCache();
    };

    await t.test("switch OFF (no stored setting = code default): every route refuses with 403 MESSAGING_DISABLED", async () => {
      for (const [action, body] of [[routes.listAction, undefined], [routes.startAction, { storeId: store1.id, context: "STORE", body: "Salam" }]] as const) {
        const result = await call(A, action, { body });
        assert.equal(result.status, 403);
        assert.equal(result.json?.code, "MESSAGING_DISABLED");
        assert.equal(result.json?.error, "Mesajlaşma hazırda əlçatan deyil.");
      }
      await enableMessaging(false);
      assert.equal((await call(S1, routes.listAction)).status, 403, "stored false: still refused");
      assert.equal(await prisma.conversation.count({ where: { customerId: { startsWith: tag } } }), 0);
    });

    await t.test("same-origin: a cross-site write is refused before the session is even resolved", async () => {
      await enableMessaging(true);
      resolverCalls = 0;
      const result = await call(A, routes.startAction, { body: { storeId: store1.id, context: "STORE", body: "Salam" }, origin: "https://evil.example" });
      assert.equal(result.status, 403);
      assert.equal(result.json?.code, "CROSS_SITE_REQUEST");
      assert.equal(resolverCalls, 0);
    });

    let productThread = "";
    let lastMessageId = "";
    await t.test("customer start: 201 new thread, 200 same context again; body cap 4 KB; JSON only; contact details 422", async () => {
      const first = await call(A, routes.startAction, { body: { storeId: store1.id, context: "PRODUCT", contextId: product1.id, body: "Bu vazanın hündürlüyü neçədir?" } });
      assert.equal(first.status, 201);
      assert.equal(first.json?.created, true);
      productThread = first.json?.conversationId;
      const again = await call(A, routes.startAction, { body: { storeId: store1.id, context: "PRODUCT", contextId: product1.id, body: "Rəngi də maraqlıdır." } });
      assert.equal(again.status, 200);
      assert.equal(again.json?.conversationId, productThread);
      const big = await call(A, routes.startAction, { rawBody: JSON.stringify({ storeId: store1.id, context: "STORE", body: "x".repeat(5000) }) });
      assert.equal(big.status, 413);
      assert.equal((await call(A, routes.startAction, { rawBody: "body=x", contentType: "text/plain" })).status, 415);
      assert.equal((await call(A, routes.startAction, { rawBody: "{not json" })).status, 400);
      const contact = await call(A, routes.startAction, { body: { storeId: store1.id, context: "STORE", body: "Zəng edin: 055 123 45 67" } });
      assert.equal(contact.status, 422);
      assert.match(contact.json?.error, /telefon nömrəsi və ya e-poçt/);
      assert.equal(await prisma.conversation.count({ where: { customerId: customerA.id } }), 1, "refused starts left nothing behind");
    });

    await t.test("404 for anything not the caller's own: other customer's order, other store's product, unknown store, bad ids", async () => {
      assert.equal((await call(B, routes.startAction, { body: { storeId: store1.id, context: "ORDER", contextId: storeOrderId, body: "x" } })).status, 404);
      assert.equal((await call(A, routes.startAction, { body: { storeId: store1.id, context: "PRODUCT", contextId: product2.id, body: "x" } })).status, 404);
      assert.equal((await call(A, routes.startAction, { body: { storeId: `${tag}-none`, context: "STORE", body: "x" } })).status, 409, "unknown or closed store: not accepting messages");
      assert.equal((await call(A, routes.startAction, { body: { storeId: "../x", context: "STORE", body: "x" } })).status, 404);
      assert.equal((await call(A, routes.startAction, { body: { storeId: store1.id, context: "WHATEVER", body: "x" } })).status, 404);
      // A store actor can never start a conversation.
      assert.equal((await call(S1, routes.startAction, { body: { storeId: store1.id, context: "STORE", body: "x" } })).status, 404);
      for (const [actor, id] of [[B, productThread], [S2, productThread], [A, "no-such-thread"], [A, "bad id!"]] as const) {
        assert.equal((await call(actor, routes.messagesAction, { params: { conversationId: id } })).status, 404, `${actor.role} ${id}: messages`);
        assert.equal((await call(actor, routes.sendAction, { params: { conversationId: id }, body: { body: "x" } })).status, 404, `${actor.role} ${id}: send`);
        assert.equal((await call(actor, routes.readAction, { params: { conversationId: id }, method: "POST" })).status, 404, `${actor.role} ${id}: read`);
        assert.equal((await call(actor, routes.blockAction, { params: { conversationId: id }, method: "POST" })).status, 404, `${actor.role} ${id}: block`);
        assert.equal((await call(actor, routes.reportAction, { params: { conversationId: id }, body: { reason: "SPAM" } })).status, 404, `${actor.role} ${id}: report`);
      }
      assert.equal(await prisma.conversationBlock.count({ where: { customerId: customerA.id } }), 0);
      assert.equal(await prisma.conversationReport.count({ where: { conversationId: productThread } }), 0);
    });

    await t.test("store isolation: lists show only the caller's own threads; the store sees a display name, never contact details", async () => {
      const own = await call(A, routes.listAction);
      assert.equal(own.status, 200);
      assert.deepEqual(own.json?.items.map((item: { id: string }) => item.id), [productThread]);
      assert.equal(own.json?.items[0].counterpart, store1.name);
      assert.equal((await call(B, routes.listAction)).json?.items.length, 0);
      const s1 = await call(S1, routes.listAction);
      assert.equal(s1.json?.items.length, 1);
      assert.equal(s1.json?.items[0].counterpart, "Aysel M.");
      assert.equal(s1.json?.items[0].unread, 2);
      assert.doesNotMatch(s1.text, /@|994501234567|Məmmədova/, "no e-mail, phone or full surname in the store's list");
      assert.equal((await call(S2, routes.listAction)).json?.items.length, 0, "store 2 sees nothing of store 1");
      assert.equal((await call(A, routes.listAction, { path: "/api/x?cursor=garbage" })).status, 200, "a malformed cursor is ignored");
    });

    await t.test("messages, polling (204 when nothing new), reply, read", async () => {
      const page = await call(A, routes.messagesAction, { params: { conversationId: productThread } });
      assert.equal(page.status, 200);
      assert.equal(page.json?.items.length, 2);
      assert.equal(page.json?.hasOlder, false);
      lastMessageId = page.json?.items[1].id;
      const quiet = await call(A, routes.messagesAction, { params: { conversationId: productThread }, path: `/api/x?after=${lastMessageId}` });
      assert.equal(quiet.status, 204);
      assert.equal(quiet.text, "");
      assert.equal((await call(A, routes.messagesAction, { params: { conversationId: productThread }, path: "/api/x?after=../x" })).status, 400);
      assert.equal((await call(A, routes.messagesAction, { params: { conversationId: productThread }, path: `/api/x?after=${lastMessageId}&before=${lastMessageId}` })).status, 400);
      const reply = await call(S1, routes.sendAction, { params: { conversationId: productThread }, body: { body: "Hündürlüyü 30 sm-dir.\n<b>Salam</b>" } });
      assert.equal(reply.status, 201);
      const fresh = await call(A, routes.messagesAction, { params: { conversationId: productThread }, path: `/api/x?after=${lastMessageId}` });
      assert.equal(fresh.status, 200);
      assert.equal(fresh.json?.items.length, 1);
      assert.equal(fresh.json?.items[0].senderRole, "STORE");
      assert.equal(fresh.json?.items[0].body, "Hündürlüyü 30 sm-dir.\n<b>Salam</b>", "stored and returned as plain text (rendered escaped)");
      assert.equal((await prisma.conversation.findUniqueOrThrow({ where: { id: productThread } })).customerUnreadCount, 1);
      assert.equal((await call(A, routes.readAction, { params: { conversationId: productThread }, method: "POST" })).status, 200);
      assert.equal((await prisma.conversation.findUniqueOrThrow({ where: { id: productThread } })).customerUnreadCount, 0);
    });

    await t.test("report: reason required, one open report per side; block: each side lifts only its own", async () => {
      assert.equal((await call(A, routes.reportAction, { params: { conversationId: productThread }, body: { reason: "NOPE" } })).status, 422);
      assert.equal((await call(A, routes.reportAction, { params: { conversationId: productThread }, body: { reason: "SPAM", note: "y".repeat(501) } })).status, 422);
      assert.equal((await call(A, routes.reportAction, { params: { conversationId: productThread }, body: { reason: "SPAM", note: "Reklam göndərir" } })).status, 201);
      assert.equal((await call(A, routes.reportAction, { params: { conversationId: productThread }, body: { reason: "ABUSE" } })).status, 200, "already open: no second report");
      assert.equal((await call(S1, routes.reportAction, { params: { conversationId: productThread }, body: { reason: "FRAUD" } })).status, 201, "the store side reports separately");
      assert.equal(await prisma.conversationReport.count({ where: { conversationId: productThread } }), 2);

      assert.equal((await call(S1, routes.blockAction, { params: { conversationId: productThread }, method: "POST" })).status, 200);
      const blocked = await call(A, routes.sendAction, { params: { conversationId: productThread }, body: { body: "Salam?" } });
      assert.equal(blocked.status, 403);
      assert.equal(blocked.json?.code, "BLOCKED");
      const customerUnblock = await call(A, routes.unblockAction, { params: { conversationId: productThread }, method: "DELETE" });
      assert.equal(customerUnblock.json?.blocked, true, "the customer cannot lift the store's block");
      const storeUnblock = await call(S1, routes.unblockAction, { params: { conversationId: productThread }, method: "DELETE" });
      assert.equal(storeUnblock.json?.blocked, false);
      assert.equal((await call(A, routes.sendAction, { params: { conversationId: productThread }, body: { body: "Təşəkkürlər" } })).status, 201);
    });

    await t.test("page read models: own thread only, display name, block state; new-message target checks", async () => {
      const seen = await views.getConversationView(prisma, { conversationId: productThread, actor: S1 });
      assert.equal(seen?.counterpart, "Aysel M.");
      assert.equal(seen?.product?.id, product1.id);
      assert.equal(seen?.unread, 1);
      assert.equal(await views.getConversationView(prisma, { conversationId: productThread, actor: S2 }), null);
      assert.equal(await views.getConversationView(prisma, { conversationId: productThread, actor: B }), null);
      assert.equal((await views.getConversationView(prisma, { conversationId: productThread, actor: A }))?.counterpart, store1.name);

      const existing = await views.resolveNewConversationTarget(prisma, { customerId: customerA.id, storeId: store1.id, productId: product1.id });
      assert.equal(existing?.existingConversationId, productThread, "the page opens the existing thread instead");
      const orderTarget = await views.resolveNewConversationTarget(prisma, { customerId: customerA.id, storeId: store1.id, storeOrderId });
      assert.equal(orderTarget?.context, "ORDER");
      assert.equal(orderTarget?.existingConversationId, null);
      assert.equal(await views.resolveNewConversationTarget(prisma, { customerId: customerB.id, storeId: store1.id, storeOrderId }), null, "someone else's order");
      assert.equal(await views.resolveNewConversationTarget(prisma, { customerId: customerA.id, storeId: store2.id, storeOrderId }), null, "order of another store");
      assert.equal(await views.resolveNewConversationTarget(prisma, { customerId: customerA.id, storeId: store1.id, productId: product2.id }), null, "product of another store");
      assert.equal(await views.resolveNewConversationTarget(prisma, { customerId: customerA.id, storeId: store1.id, productId: product1.id, storeOrderId }), null, "two contexts at once");
      const closed = await mkStore(3, (await mkUser("s3", "VENDOR")).id, false);
      assert.equal(await views.resolveNewConversationTarget(prisma, { customerId: customerA.id, storeId: closed.id }), null, "store not public");
      assert.equal((await views.resolveNewConversationTarget(prisma, { customerId: customerA.id, storeId: store1.id }))?.context, "STORE");
    });
  } finally {
    const { authRateLimitKey, clearAuthRateLimit } = await import("../lib/auth-rate-limit").catch(() => ({ authRateLimitKey: null, clearAuthRateLimit: null }) as never);
    if (authRateLimitKey && clearAuthRateLimit) for (const identity of limiterIdentities) await clearAuthRateLimit(authRateLimitKey("messaging", identity)).catch(() => undefined);
    if (settingWritten) {
      await prisma.siteSetting.deleteMany({ where: { key: "messaging.enabled" } }).catch(() => undefined);
      await prisma.siteSettingRevision.deleteMany({ where: { key: "messaging.enabled" } }).catch(() => undefined);
    }
    await prisma.emailOutbox.deleteMany({ where: { recipient: { contains: tag } } }).catch(() => undefined);
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
