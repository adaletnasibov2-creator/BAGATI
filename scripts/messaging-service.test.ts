/** Static checks on the messaging service (phase 4); its behaviour is tested in messaging.integration.test.ts (5433). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { buildTransactionalEmail, EMAIL_TEMPLATES } from "../lib/email-templates";
import { decodeConversationCursor, encodeConversationCursor, MessagingError } from "../lib/messaging-service";
import { MESSAGE_EMAIL_WINDOW_MS, messageEmailEventKey } from "../lib/messaging";
import { AGE_LIMITED_TEMPLATES, isNotificationTooOld, NOTIFICATION_MAX_AGE_MS } from "../lib/email-outbox-worker";

const service = readFileSync(resolve(process.cwd(), "lib/messaging-service.ts"), "utf8").replace(/\r\n/g, "\n");

test("writes lock the conversation row, and take their timestamp after the lock", () => {
  assert.match(service, /await tx\.\$queryRaw`SELECT "id" FROM "Conversation" WHERE "id" = \$\{conversationId\} FOR UPDATE`;/);
  assert.match(service, /await lockConversation\(tx, input\.conversationId\);\n    const now = input\.clock\(\);/, "send: lock, then clock");
  assert.match(service, /await lockConversation\(tx, input\.conversationId\);\n    \/\/ Taken after the lock, like a send \(see sendMessageLocked\)\.\n    const now = ctx\.now\?\.\(\) \?\? new Date\(\);/, "read: lock, then clock");
  assert.match(service, /storeUnreadCount: \{ increment: 1 \}, customerUnreadCount: 0/);
  assert.match(service, /customerUnreadCount: \{ increment: 1 \}, storeUnreadCount: 0/);
  // The block is re-checked under the lock, so a block that committed a moment ago wins over a send.
  assert.match(service, /\/\/ Re-checked under the lock: a block that committed a moment ago wins\.\n    if \(await isBlocked\(tx,/);
});

test("only customers start; settings gate sends; rate limits use the messaging scope", () => {
  assert.match(service, /if \(!customer \|\| customer\.role !== "CUSTOMER" \|\| !customer\.isActive\) fail\("NOT_FOUND"/);
  assert.equal(service.match(/requireEnabled\(ctx\);/g)?.length, 2, "start and send");
  assert.match(service, /authRateLimitKey\("messaging", identity\)/);
  assert.match(readFileSync(resolve(process.cwd(), "lib/auth-rate-limit.ts"), "utf8"), /\| "admin-login" \| "messaging" \| "seller-application", identity: string\)/);
});

test("list outputs carry no e-mail or phone fields", () => {
  const list = service.slice(service.indexOf("export async function listConversations"), service.indexOf("export async function listMessages"));
  assert.doesNotMatch(list, /(email|phone|contactEmail|contactPhone): true/, "no contact field is selected");
  assert.match(list, /customerProfile: \{ select: \{ firstName: true, lastName: true \} \}/);
  const messages = service.slice(service.indexOf("export async function listMessages"), service.indexOf("// ---- Block"));
  assert.match(messages, /const select = \{ id: true, senderRole: true, body: true, createdAt: true \} as const;/);
});

test("e-mails: link only, never the message text", () => {
  for (const template of ["MESSAGE_TO_STORE", "MESSAGE_TO_CUSTOMER"] as const) {
    assert.ok(EMAIL_TEMPLATES.includes(template));
    const mail = buildTransactionalEmail(template, { storeName: "Ev Dünyası", url: "https://shop.example.invalid/x" }, "BAGATI <no-reply@example.invalid>", "r@example.invalid", "<t@example.invalid>");
    const text = JSON.stringify(mail);
    assert.match(text, /https:\/\/shop\.example\.invalid\/x/);
    assert.match(text, /Ev Dünyası/);
  }
  const notify = service.slice(service.indexOf("async function notifyOtherSide"), service.indexOf("// ---- Customer starts"));
  assert.ok(notify.length > 100);
  assert.doesNotMatch(notify, /body/, "the e-mail payload never includes the message body");
  assert.equal(notify.match(/payload: \{ storeName: store\.name, url: /g)?.length, 2);
});

test("in-process email worker: both messaging templates are sendable and limited to 24 h; one e-mail per window", () => {
  for (const template of ["MESSAGE_TO_STORE", "MESSAGE_TO_CUSTOMER"]) {
    assert.ok((EMAIL_TEMPLATES as readonly string[]).includes(template), `${template} passes the worker's template allowlist`);
    assert.ok(AGE_LIMITED_TEMPLATES.has(template), `${template} is FAILED NOTIFICATION_STALE after 24 h`);
  }
  assert.ok([...AGE_LIMITED_TEMPLATES].every((template) => (EMAIL_TEMPLATES as readonly string[]).includes(template)), "no age rule for an unknown template");
  assert.equal(NOTIFICATION_MAX_AGE_MS, 24 * 60 * 60 * 1000);
  // Dedupe key: conversation + recipient side + 15-minute window; the outbox upsert turns a repeat into a no-op.
  const t0 = Date.UTC(2026, 10, 18, 10, 0, 0);
  assert.equal(messageEmailEventKey("c1", "STORE", t0), messageEmailEventKey("c1", "STORE", t0 + MESSAGE_EMAIL_WINDOW_MS - 1));
  assert.notEqual(messageEmailEventKey("c1", "STORE", t0), messageEmailEventKey("c1", "STORE", t0 + MESSAGE_EMAIL_WINDOW_MS));
  assert.notEqual(messageEmailEventKey("c1", "STORE", t0), messageEmailEventKey("c1", "CUSTOMER", t0));
  assert.notEqual(messageEmailEventKey("c1", "STORE", t0), messageEmailEventKey("c2", "STORE", t0));
  assert.ok(isNotificationTooOld("MESSAGE_TO_CUSTOMER", new Date(t0), new Date(t0 + NOTIFICATION_MAX_AGE_MS + 1)));
  assert.ok(!isNotificationTooOld("MESSAGE_TO_CUSTOMER", new Date(t0), new Date(t0 + NOTIFICATION_MAX_AGE_MS)));
});

test("inbox cursor: round trip; malformed cursors are ignored", () => {
  const cursor = { lastMessageAt: new Date("2026-11-16T10:00:00.000Z"), id: "abc_1" };
  assert.deepEqual(decodeConversationCursor(encodeConversationCursor(cursor)), cursor);
  for (const bad of [null, "", "not-base64!", Buffer.from("{}").toString("base64url"), Buffer.from(JSON.stringify({ t: "x", i: "a" })).toString("base64url"), Buffer.from(JSON.stringify({ t: cursor.lastMessageAt.toISOString(), i: "../x" })).toString("base64url"), "x".repeat(201)]) {
    assert.equal(decodeConversationCursor(bad), null, String(bad));
  }
  assert.equal(new MessagingError("BLOCKED", "x").code, "BLOCKED");
});

test("orphans (customer account deleted) are admin-only; deletion keeps only OPEN-reported threads", () => {
  // Every store/customer path goes through loadOwned, which refuses a NULL customer; lists, badge and page view exclude it.
  assert.match(service, /if \(!conversation \|\| conversation\.customerId === null\) return null;/);
  assert.match(service, /\{ storeId: input\.actor\.storeId, customerId: \{ not: null \} \}/, "store list");
  assert.match(service, /\{ storeId: actor\.storeId, customerId: \{ not: null \}, storeUnreadCount: \{ gt: 0 \} \}/, "store badge");
  assert.match(readFileSync(resolve(process.cwd(), "lib/messaging-views.ts"), "utf8"), /if \(!row \|\| row\.customerId === null\) return null;/, "page view");
  for (const fn of ["sendMessageLocked", "markConversationRead", "listMessages", "blockCounterpart", "unblockCounterpart", "reportConversation"]) {
    const start = service.indexOf(`function ${fn}`);
    assert.ok(start > 0, fn);
    assert.match(service.slice(start, start + 900), /loadOwned\(/, `${fn} checks ownership`);
  }
  assert.match(service, /deleteMany\(\{ where: \{ customerId: userId, reports: \{ none: \{ status: "OPEN" \} \} \} \}\)/);
  const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
  assert.match(schema, /customerId {10}String\?\r?\n/);
  assert.match(schema, /customer {12}User\? {17}@relation\("ConversationCustomer", fields: \[customerId\], references: \[id\], onDelete: SetNull\)/);
  const migration = readFileSync(resolve(process.cwd(), "prisma/migrations/20261117010000_customer_store_messaging/migration.sql"), "utf8");
  assert.match(migration, /"Conversation_customerId_fkey" FOREIGN KEY \("customerId"\) REFERENCES "User"\("id"\) ON DELETE SET NULL/);
  assert.match(migration, /"ConversationBlock_customerId_fkey" FOREIGN KEY \("customerId"\) REFERENCES "User"\("id"\) ON DELETE CASCADE/, "blocks still cascade");
});
