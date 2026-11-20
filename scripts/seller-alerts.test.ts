/**
 * SELLER-ALERTS: new-order email to the seller (after the commit, no customer data, deduped), the optional verified
 * extra notification email, and the seller panel's new-order alerts. The browser/scratch check is in
 * release-output/seller-alerts/.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

process.env.EMAIL_ENCRYPTION_KEY ??= randomBytes(32).toString("hex");
process.env.APP_BASE_URL ??= "https://shopbagati.com";

import { decryptEmailSecret } from "../lib/email-outbox";
import { stableEmailDedupeKey } from "../lib/email-outbox-core";
import { buildTransactionalEmail, EMAIL_TEMPLATES, sellerNewOrderSubject } from "../lib/email-templates";
import { queueSellerNewOrderEmails, sellerOrderEmailPayload, sellerOrderNumber, sellerOrderRecipients, type SellerOrderEmailStoreOrder } from "../lib/seller-order-emails";
import {
  hashNotificationEmailToken, normalizeNotificationEmail, notificationEmailVerifyUrl, removeNotificationEmail,
  resendNotificationEmail, saveNotificationEmail, verifyNotificationEmailToken, NOTIFICATION_EMAIL_SEND_LIMIT,
} from "../lib/store-notification-email";
import { isOrdersPath, nextOrderAlertsDelay, parseOrderAlertsAfter, titleWithOrderCount } from "../lib/vendor-order-alerts";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const FROM = "BAGATI <no-reply@shopbagati.com>";

const storeOrder = (over: Partial<SellerOrderEmailStoreOrder> = {}): SellerOrderEmailStoreOrder => ({
  id: "so_1", storeId: "store_1", subtotal: "40.00", deliveryFee: "5.00",
  store: { id: "store_1", name: "Aysel Zərgərlik", vendor: { user: { email: "Seller@Example.az" } } },
  items: [{ productName: "Gümüş üzük", variantName: null, quantity: 1 }, { productName: "Sırğa", variantName: "Qızılı / S", quantity: 2 }],
  ...over,
});
const CUSTOMER_WORDS = /recipientName|phone|address|line1|customer|alıcı adı|Leyla|\+994|@customer/i;

// ---------------------------------------------------------------------------------------------------------------
// Part A: the new-order email

test("payload: store name, order number, the store's items, subtotal / delivery / total, panel link; nothing else", () => {
  const payload = sellerOrderEmailPayload({ id: "cmwporder0000abcd1234" }, storeOrder(), "https://shopbagati.com");
  assert.deepEqual(payload, {
    storeName: "Aysel Zərgərlik", orderRef: "ABCD1234", storeOrderRef: "so_1",
    itemLines: "Gümüş üzük × 1\nSırğa (Qızılı / S) × 2",
    subtotal: "40.00", deliveryFee: "5.00", total: "45.00",
    panelUrl: "https://shopbagati.com/vendor/store_1/orders/so_1",
  });
  assert.equal(sellerOrderNumber("cmwporder0000abcd1234"), "ABCD1234", "the number sellers already see in the panel");
  const noisy = sellerOrderEmailPayload({ id: "x" }, storeOrder({ items: [{ productName: "Ad\r\nBcc: evil@x.az", variantName: null, quantity: 1 }] }), "https://shopbagati.com");
  assert.doesNotMatch(String(noisy.itemLines), /[\r\n]/, "names cannot add lines");
});

test("email: subject 'Yeni sifariş: {store} · №{number}', the body lines, a 'Sifarişlərə bax' link, no customer data", () => {
  const payload = sellerOrderEmailPayload({ id: "cmwporder0000abcd1234" }, storeOrder(), "https://shopbagati.com");
  const mail = buildTransactionalEmail("SELLER_NEW_ORDER", payload, FROM, "seller@example.az", "m1");
  assert.equal(mail.subject, "Yeni sifariş: Aysel Zərgərlik · №ABCD1234");
  assert.equal(mail.text, [
    "Aysel Zərgərlik mağazanıza yeni sifariş gəldi.", "Sifariş №ABCD1234", "Məhsullar:", "• Gümüş üzük × 1", "• Sırğa (Qızılı / S) × 2",
    "Ara cəm: 40.00 AZN", "Çatdırılma: 5.00 AZN", "Mağaza cəmi: 45.00 AZN",
    "Alıcının məlumatlarını və sifarişin təfərrüatını satıcı panelində görə bilərsiniz.",
    "Sifarişlərə bax: https://shopbagati.com/vendor/store_1/orders/so_1",
  ].join("\n\n"));
  assert.match(String(mail.html), /<a href="https:\/\/shopbagati\.com\/vendor\/store_1\/orders\/so_1" rel="noopener noreferrer"[^>]*>Sifarişlərə bax<\/a>/);
  assert.doesNotMatch(`${mail.subject}\n${mail.text}\n${mail.html}`, CUSTOMER_WORDS);
  assert.equal(sellerNewOrderSubject("A\r\nBcc: x", "1"), "Yeni sifariş: A Bcc: x · №1", "no header injection");
  // Rows queued before this change (old payload) still render with the old wording.
  const old = buildTransactionalEmail("SELLER_NEW_ORDER", { storeName: "Mağaza", orderRef: "o1", storeOrderRef: "so1", total: 45 }, FROM, "s@x.az", "m2");
  assert.equal(old.subject, "Mağazanıza yeni sifariş daxil oldu");
  // A bad panel link is dropped, never rendered.
  const bad = buildTransactionalEmail("SELLER_NEW_ORDER", { ...payload, panelUrl: "javascript:alert(1)" }, FROM, "s@x.az", "m3");
  assert.doesNotMatch(String(bad.html), /javascript:|Sifarişlərə bax/);
});

test("recipients: the account email always; the extra address only when verified and different; lower-cased", () => {
  assert.deepEqual(sellerOrderRecipients("Seller@Example.az", null), ["seller@example.az"]);
  assert.deepEqual(sellerOrderRecipients("seller@example.az", { notificationEmail: "staff@example.az", notificationEmailVerifiedAt: null }), ["seller@example.az"], "unverified: not used");
  assert.deepEqual(sellerOrderRecipients("seller@example.az", { notificationEmail: "staff@example.az", notificationEmailVerifiedAt: new Date() }), ["seller@example.az", "staff@example.az"]);
  assert.deepEqual(sellerOrderRecipients("Seller@Example.az", { notificationEmail: "seller@example.az", notificationEmailVerifiedAt: new Date() }), ["seller@example.az"], "same address once");
});

function fakeQueueClient(options: { failRecipient?: string; storeLookupFails?: boolean; verified?: Record<string, string> } = {}) {
  const rows = new Map<string, { recipient: string; template: string; payload: unknown }>();
  return {
    rows,
    store: { findMany: async () => { if (options.storeLookupFails) throw new Error("db"); return Object.entries(options.verified ?? {}).map(([id, email]) => ({ id, notificationEmail: email, notificationEmailVerifiedAt: new Date() })); } },
    emailOutbox: { upsert: async (args: { where: { dedupeKey: string }; create: { recipient: string; template: string; payload: unknown } }) => {
      if (args.create.recipient === options.failRecipient) throw new Error("queue down");
      if (!rows.has(args.where.dedupeKey)) rows.set(args.where.dedupeKey, args.create);
      return { id: "row" };
    } },
  };
}

test("queue: one row per StoreOrder per recipient, deduped on retry, encrypted, never throws", async () => {
  const order = { id: "cmwporder0000abcd1234", storeOrders: [storeOrder(), storeOrder({ id: "so_2", storeId: "store_2", store: { id: "store_2", name: "Gəncə Keramika", vendor: { user: { email: "other@example.az" } } } })] };
  const client = fakeQueueClient({ verified: { store_1: "staff@example.az" } });
  assert.deepEqual(await queueSellerNewOrderEmails(client as never, order), { queued: 3, failed: 0 });
  assert.deepEqual(await queueSellerNewOrderEmails(client as never, order), { queued: 3, failed: 0 }, "a second run is a no-op (upsert)");
  assert.equal(client.rows.size, 3, "dedupe: still 3 rows");
  for (const [key, recipient] of [["so_1", "seller@example.az"], ["so_1", "staff@example.az"], ["so_2", "other@example.az"]]) {
    const row = client.rows.get(stableEmailDedupeKey(`seller-new-order:${key}:${recipient}`));
    assert.ok(row, `${key} -> ${recipient}`);
    assert.equal(row.template, "SELLER_NEW_ORDER");
    const encrypted = (row.payload as { encrypted: string }).encrypted;
    assert.doesNotMatch(JSON.stringify(row.payload), /Aysel|40\.00/, "stored encrypted");
    const payload = JSON.parse(decryptEmailSecret(encrypted));
    assert.deepEqual(Object.keys(payload).sort(), ["deliveryFee", "itemLines", "orderRef", "panelUrl", "storeName", "storeOrderRef", "subtotal", "total"]);
    assert.doesNotMatch(JSON.stringify(payload), CUSTOMER_WORDS);
  }
  const failing = fakeQueueClient({ failRecipient: "seller@example.az" });
  assert.deepEqual(await queueSellerNewOrderEmails(failing as never, order), { queued: 1, failed: 1 }, "one failure is skipped, the rest is queued");
  const lookupDown = fakeQueueClient({ storeLookupFails: true });
  assert.deepEqual(await queueSellerNewOrderEmails(lookupDown as never, order), { queued: 2, failed: 0 }, "store lookup failure: account emails still go");
});

test("order route: the seller email is queued after the commit, not awaited, outside the transaction; order unchanged", () => {
  const route = read("app/api/orders/route.ts");
  const tx = route.slice(route.indexOf("const order=await withOrderSerializationRetry"), route.indexOf("return NextResponse.json({order},{status:201});"));
  assert.doesNotMatch(tx.slice(0, tx.indexOf("},{isolationLevel:")), /SELLER_NEW_ORDER|queueSellerNewOrderEmails/, "nothing inside the transaction");
  assert.match(route, /\},\{isolationLevel:Prisma\.TransactionIsolationLevel\.Serializable,maxWait:10000,timeout:20000\}\)\);\n[\s\S]*void queueSellerNewOrderEmails\(prisma,order as SellerOrderEmailOrder\)\.catch\(\(\)=>undefined\);\n\s*return NextResponse\.json\(\{order\},\{status:201\}\);/);
  // Customer email and the in-app seller notification stay in the transaction as before.
  assert.match(tx, /template:"CUSTOMER_ORDER_CONFIRMED"/);
  assert.match(tx, /title:VENDOR_NOTIFICATION_TITLES\.newOrder/);
});

// ---------------------------------------------------------------------------------------------------------------
// Part B: the extra notification email

type FakeToken = { id: string; storeId: string; email: string; tokenHash: string; expiresAt: Date; usedAt: Date | null };
function fakeNotificationDb() {
  const store = { id: "store_1", name: "Aysel Zərgərlik", notificationEmail: null as string | null, notificationEmailVerifiedAt: null as Date | null };
  const tokens: FakeToken[] = [];
  const outbox: { recipient: string; template: string; payload: unknown }[] = [];
  const pick = (fields: Record<string, boolean>) => Object.fromEntries(Object.keys(fields).map((key) => [key, (store as Record<string, unknown>)[key]]));
  const tx = {
    store: {
      findUniqueOrThrow: async ({ select }: { select: Record<string, boolean> }) => pick(select),
      update: async ({ data, select }: { data: Partial<typeof store>; select: Record<string, boolean> }) => { Object.assign(store, data); return pick(select); },
      updateMany: async ({ where, data }: { where: { id: string; notificationEmail: string }; data: Partial<typeof store> }) => {
        if (store.id !== where.id || store.notificationEmail !== where.notificationEmail) return { count: 0 };
        Object.assign(store, data); return { count: 1 };
      },
    },
    storeNotificationEmailToken: {
      updateMany: async ({ where, data }: { where: { id?: string; storeId?: string; usedAt: null; expiresAt?: { gt: Date } }; data: { usedAt: Date } }) => {
        let count = 0;
        for (const token of tokens) if ((!where.id || token.id === where.id) && (!where.storeId || token.storeId === where.storeId) && token.usedAt === null && (!where.expiresAt || token.expiresAt > where.expiresAt.gt)) { token.usedAt = data.usedAt; count += 1; }
        return { count };
      },
      create: async ({ data }: { data: Omit<FakeToken, "id" | "usedAt"> }) => { tokens.push({ ...data, id: `t${tokens.length}`, usedAt: null }); return {}; },
      findUnique: async ({ where }: { where: { tokenHash: string } }) => tokens.find((token) => token.tokenHash === where.tokenHash) ?? null,
    },
    emailOutbox: { upsert: async ({ create }: { create: { recipient: string; template: string; payload: unknown } }) => { outbox.push(create); return {}; } },
  };
  return { store, tokens, outbox, db: { $transaction: async (run: (client: typeof tx) => unknown) => run(tx) } };
}
const lastToken = (outbox: { payload: unknown }[]) => new URL(JSON.parse(decryptEmailSecret((outbox.at(-1)!.payload as { encrypted: string }).encrypted)).verifyUrl).hash.replace("#token=", "");

test("extra email: saved unverified with a link; verify once; change resets; resend; remove; expiry and wrong address fail", async () => {
  assert.equal(normalizeNotificationEmail("  Staff@Example.AZ "), "staff@example.az");
  for (const bad of ["", "nope", "a@b", "x".repeat(250) + "@a.az", 42, null]) assert.equal(normalizeNotificationEmail(bad), null, String(bad));
  const { store, tokens, outbox, db } = fakeNotificationDb();
  const t0 = new Date("2026-11-21T10:00:00Z");
  assert.deepEqual(await saveNotificationEmail(db as never, { storeId: "store_1", email: "staff@example.az", now: t0 }), { email: "staff@example.az", verified: false, sent: true });
  assert.equal(outbox.at(-1)!.template, "STORE_NOTIFICATION_EMAIL_VERIFY");
  assert.equal(outbox.at(-1)!.recipient, "staff@example.az");
  const token = lastToken(outbox);
  assert.equal(tokens[0].tokenHash, hashNotificationEmailToken(token), "only the hash is stored");
  assert.notEqual(tokens[0].tokenHash, token);
  assert.equal(await verifyNotificationEmailToken(db as never, token, new Date(t0.getTime() + 60_000)), true);
  assert.ok(store.notificationEmailVerifiedAt, "verified");
  assert.equal(await verifyNotificationEmailToken(db as never, token, new Date(t0.getTime() + 120_000)), false, "single use");
  assert.deepEqual(await saveNotificationEmail(db as never, { storeId: "store_1", email: "staff@example.az", now: t0 }), { email: "staff@example.az", verified: true, sent: false }, "same verified address: nothing sent");
  await saveNotificationEmail(db as never, { storeId: "store_1", email: "other@example.az", now: t0 });
  assert.equal(store.notificationEmailVerifiedAt, null, "changing the address resets verification");
  const first = lastToken(outbox);
  assert.equal((await resendNotificationEmail(db as never, { storeId: "store_1", now: t0 })).sent, true);
  const second = lastToken(outbox);
  assert.equal(await verifyNotificationEmailToken(db as never, first, t0), false, "a resend invalidates the earlier link");
  assert.equal(await verifyNotificationEmailToken(db as never, second, new Date(t0.getTime() + 25 * 3600_000)), false, "expired after 24 h");
  await resendNotificationEmail(db as never, { storeId: "store_1", now: t0 });
  const third = lastToken(outbox);
  store.notificationEmail = "changed@example.az"; // the address changed after the link was sent
  assert.equal(await verifyNotificationEmailToken(db as never, third, t0), false, "a link verifies only its own address");
  assert.deepEqual(await removeNotificationEmail(db as never, { storeId: "store_1", now: t0 }), { email: null, verified: false });
  assert.equal(tokens.every((row) => row.usedAt !== null), true, "removing closes every open link");
  assert.equal(await verifyNotificationEmailToken(db as never, "short", t0), false);
  assert.deepEqual(NOTIFICATION_EMAIL_SEND_LIMIT, { limit: 3, windowMs: 3_600_000 });
  assert.match(notificationEmailVerifyUrl("abc", "https://shopbagati.com")!, /^https:\/\/shopbagati\.com\/vendor\/notification-email\/verify#token=abc$/, "token in the fragment");
  assert.ok(EMAIL_TEMPLATES.includes("STORE_NOTIFICATION_EMAIL_VERIFY"));
  const mail = buildTransactionalEmail("STORE_NOTIFICATION_EMAIL_VERIFY", { storeName: "Aysel Zərgərlik", verifyUrl: "https://shopbagati.com/vendor/notification-email/verify#token=abc" }, FROM, "staff@example.az", "m4");
  assert.equal(mail.subject, "BAGATI — bildiriş e-poçtunu təsdiqləyin");
  assert.throws(() => buildTransactionalEmail("STORE_NOTIFICATION_EMAIL_VERIFY", { storeName: "x", verifyUrl: "javascript:1" }, FROM, "s@x.az", "m5"));
});

test("extra email API: own store only, rate-limited sends, CSRF via middleware; verify page reads the token from the fragment", () => {
  const api = read("app/api/vendor/[storeId]/notification-email/route.ts");
  assert.match(api, /const access = await requireStoreAccess\(storeId\);\n\s*return access\?\.user\.role === "VENDOR" \? access : null;/);
  assert.equal(api.match(/if \(!\(await withinSendLimit\(access\.storeId\)\)\) return json\(\{ error: MESSAGES\.rateLimited \}, 429\);/g)?.length, 2, "save and resend are limited");
  assert.match(api, /authRateLimitKey\("store-notification-email", storeId\)/);
  const verify = read("components/notification-email-verify.tsx");
  assert.match(verify, /new URLSearchParams\(window\.location\.hash\.slice\(1\)\)\.get\("token"\)/);
  assert.match(verify, /window\.history\.replaceState\(null, "", window\.location\.pathname\);/);
  assert.doesNotMatch(read("app/vendor/notification-email/verify/page.tsx"), /PublicTheme/, "nothing under app/vendor renders the public theme");
});

// ---------------------------------------------------------------------------------------------------------------
// Part C: alerts

test("alerts helpers: after clamped to 7 days, polling 30 s / 120 s with back-off, title counter, orders path", () => {
  const now = new Date("2026-11-21T12:00:00Z");
  assert.equal(parseOrderAlertsAfter(null, now), null);
  assert.equal(parseOrderAlertsAfter("nonsense", now), null);
  assert.equal(parseOrderAlertsAfter("2026-11-21T11:59:00.000Z", now)!.toISOString(), "2026-11-21T11:59:00.000Z");
  assert.equal(parseOrderAlertsAfter("2020-01-01T00:00:00Z", now)!.toISOString(), "2026-11-14T12:00:00.000Z", "at most 7 days back");
  assert.equal(parseOrderAlertsAfter("2030-01-01T00:00:00Z", now)!.toISOString(), now.toISOString(), "never in the future");
  assert.equal(nextOrderAlertsDelay({ hidden: false, errors: 0 }), 30_000);
  assert.equal(nextOrderAlertsDelay({ hidden: true, errors: 0 }), 120_000);
  assert.equal(nextOrderAlertsDelay({ hidden: false, errors: 2 }), 120_000);
  assert.equal(nextOrderAlertsDelay({ hidden: true, errors: 9 }), 600_000, "capped at 10 minutes");
  assert.equal(titleWithOrderCount("Sifarişlər | BAGATI", 3), "(3) Sifarişlər | BAGATI");
  assert.equal(titleWithOrderCount("(3) Sifarişlər | BAGATI", 5), "(5) Sifarişlər | BAGATI", "no stacking");
  assert.equal(titleWithOrderCount("(99+) X", 0), "X");
  assert.equal(titleWithOrderCount("X", 120), "(99+) X");
  assert.ok(isOrdersPath("/vendor/s1/orders", "s1") && isOrdersPath("/vendor/s1/orders/so1", "s1"));
  assert.ok(!isOrdersPath("/vendor/s1/ordersx", "s1") && !isOrdersPath("/vendor/s2/orders", "s1"));
});

test("alerts endpoint: own store only, count/newest only (no customer data), status NEW, existing index, no-store", () => {
  const route = read("app/api/vendor/[storeId]/order-alerts/route.ts");
  assert.match(route, /const access = await requireStoreAccess\(storeId\);\n\s*if \(!access \|\| access\.user\.role !== "VENDOR"\) return json\(\{ error: "Unauthorized" \}, \(await currentUser\(\)\) \? 404 : 401\);/);
  assert.match(route, /WHERE "storeId" = \$\{access\.storeId\} AND "status" = 'NEW' AND "createdAt" > \(\$\{after\.toISOString\(\)\}::timestamptz AT TIME ZONE 'UTC'\)/, "scoped to the seller's own store; after compared in UTC");
  assert.match(route, /SELECT count\(\*\)::int AS "count",\n\s*\(array_agg\("id" ORDER BY "createdAt" DESC\)\)\[1\] AS "newestId",\n\s*max\("createdAt"\) AS "newestAt"\n\s*FROM "StoreOrder"/);
  assert.doesNotMatch(route, /addressSnapshot|userId|email|phone|"Order"/, "no customer data");
  assert.match(route, /"Cache-Control": "no-store"/);
  assert.match(read("prisma/schema.prisma"), /model StoreOrder \{[\s\S]*?@@index\(\[storeId, status, createdAt\]\)/, "served by the existing index");
});

test("panel: sound toggle (default off, localStorage in try/catch), Web Audio beep, one request in flight, header mount", () => {
  const ui = read("components/vendor-order-alerts.tsx");
  assert.match(ui, /const \[soundOn, setSoundOn\] = useState\(false\);/, "off by default");
  assert.match(ui, /const read = \(key: string\) => \{ try \{ return window\.localStorage\.getItem\(key\); \} catch \{ return null; \} \};/);
  assert.match(ui, /const label = soundOn \? "Səs bildirişi: açıq" : "Səs bildirişi: bağlı";/);
  assert.match(ui, /aria-pressed=\{soundOn\}/);
  assert.match(ui, /context\.createOscillator\(\)/, "generated tone, no audio file");
  assert.match(ui, /if \(stopped \|\| inFlight\) return;/, "never more than one request");
  assert.match(ui, /if \(response\.status === 401 \|\| response\.status === 404\) \{ stopped = true; return; \}/, "stops when signed out");
  assert.match(ui, /className="fixed inset-x-4 bottom-4 z-50/, "toast is fixed: no layout shift");
  assert.match(ui, /createPortal\(<div role="status"[\s\S]*<\/div>, document\.body\)\}/, "portalled out of the backdrop-filter header");
  for (const text of ["Yeni sifariş gəldi", "Sifarişlərə bax"]) assert.ok(ui.includes(text), text);
  const layout = read("app/vendor/[storeId]/layout.tsx");
  assert.match(layout, /<VendorOrderAlerts storeId=\{storeId\}\/>\n\s*<Link href=\{`\/vendor\/\$\{storeId\}\/notifications`\}/);
  const card = read("components/vendor-notification-email.tsx");
  for (const text of ["Əlavə bildiriş e-poçtu", "Yeni sifarişlər həm hesab e-poçtunuza, həm də bu ünvana göndərilir.", "Təsdiq gözləyir", "Təsdiqlənib", "Təsdiq e-poçtunu yenidən göndər", ">Sil<"]) assert.ok(card.includes(text), text);
});

// ---------------------------------------------------------------------------------------------------------------
// Migration

test("migration: additive only, IF NOT EXISTS, guarded foreign key, no drops or rewrites", () => {
  const sql = read("prisma/migrations/20261121010000_store_notification_email/migration.sql");
  assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE FROM|UPDATE\s+"|RENAME|ALTER COLUMN)\b/i);
  assert.match(sql, /ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "notificationEmail" VARCHAR\(254\);/);
  assert.match(sql, /ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "notificationEmailVerifiedAt" TIMESTAMP\(3\);/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "StoreNotificationEmailToken"/);
  assert.equal(sql.match(/CREATE (UNIQUE )?INDEX IF NOT EXISTS/g)?.length, 3);
  assert.match(sql, /IF NOT EXISTS \(\n\s*SELECT 1 FROM pg_constraint c[\s\S]*ADD CONSTRAINT "StoreNotificationEmailToken_storeId_fkey" FOREIGN KEY \("storeId"\) REFERENCES "Store"\("id"\) ON DELETE CASCADE/);
  assert.doesNotMatch(readFileSync(join(root, "prisma/migrations/20261121010000_store_notification_email/migration.sql"), "utf8"), /\r/, "LF file (Prisma checksum)");
  assert.equal(createHash("sha256").update(readFileSync(join(root, "prisma/migrations/20261121010000_store_notification_email/migration.sql"))).digest("hex"), "6fcbf5d0617006ddfb5af5248adbefb2706f24cbce605a4866315674549b65b6", "the checksum in the production SQL file");
});
