/**
 * Messaging phases 5 (customer) and 6 (seller): static route and page checks, the HTTP helpers, and the client-side
 * polling and link rules. Database behaviour is in scripts/messaging-routes.integration.test.ts (5433 scratch schema).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  customerThreadHref,
  isStopPollStatus,
  loginThenHref,
  MESSAGE_POLL,
  messageEntryHref,
  newConversationHref,
  nextPollDelay,
  pollStopMessage,
  storeThreadApi,
  storeThreadHref,
} from "../lib/messaging-client";
import { MESSAGING_DISABLED_CODE, messagingErrorResponse, messagingGate, readMessagingBody } from "../lib/messaging-http";
import { MessagingError } from "../lib/messaging-service";
import { MESSAGING_LIMIT_DEFAULTS } from "../lib/messaging";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
const routeFiles = (dir: string): string[] => readdirSync(resolve(process.cwd(), dir)).flatMap((name) => {
  const path = join(dir, name);
  return statSync(resolve(process.cwd(), path)).isDirectory() ? routeFiles(path) : name === "route.ts" ? [path.replace(/\\/g, "/")] : [];
});

test("routes: every customer route uses customerActor, every seller route authorizeStoreActor; writes are same-origin checked", () => {
  const customer = routeFiles("app/api/account/messages");
  const seller = routeFiles("app/api/vendor/[storeId]/messages");
  assert.equal(customer.length, 5);
  assert.equal(seller.length, 5);
  for (const [files, actor, other] of [[customer, "customerActor", "authorizeStoreActor"], [seller, "authorizeStoreActor", "customerActor"]] as const) {
    for (const file of files) {
      const source = read(file);
      assert.match(source, /export const dynamic = "force-dynamic";/, file);
      assert.doesNotMatch(source, new RegExp(other), `${file}: wrong actor`);
      const methods = [...source.matchAll(/export const (GET|POST|DELETE|PATCH|PUT) = messagingRoute\((\w+), (\w+), \{ write: (true|false) \}\);/g)];
      assert.ok(methods.length >= 1, `${file}: methods go through messagingRoute`);
      assert.equal(methods.length, (source.match(/export const (GET|POST|DELETE|PATCH|PUT)\b/g) ?? []).length, `${file}: no method bypasses messagingRoute`);
      for (const [, method, usedActor, , write] of methods) {
        assert.equal(usedActor, actor, `${file} ${method}`);
        assert.equal(write, method === "GET" ? "false" : "true", `${file} ${method}: writes are same-origin checked`);
      }
    }
  }
  // The store never starts a conversation: no start action on the seller side.
  assert.ok(seller.every((file) => !read(file).includes("startAction")));
});

test("pipeline: same-origin, then actor, then the switch, then the action; seller actor uses the verified storeId", () => {
  const source = read("lib/messaging-routes.ts");
  const run = source.slice(source.indexOf("export async function runMessagingRoute"), source.indexOf("export function messagingRoute"));
  const order = ["csrfRejection(request)", "await resolveActor(params)", "await messagingGate()", "return action("].map((step) => run.indexOf(step));
  assert.ok(order.every((index, i) => index > 0 && (i === 0 || index > order[i - 1])), `order: ${order}`);
  assert.match(source, /const customer = await requireRole\("CUSTOMER"\);\n  if \(!customer\) return \{ response: messagingUnauthenticated\(\) \};/);
  assert.match(source, /const access = isMessagingId\(storeId\) \? await requireStoreAccess\(storeId\) : null;\n  if \(access\) return \{ actor: \{ role: "STORE", userId: access\.user\.id, storeId: access\.storeId \} \};/);
  assert.match(source, /return \{ response: \(await requireRole\("VENDOR"\)\) \? messagingNotFound\(\) : messagingUnauthenticated\(\) \};/, "another store's id is 404");
  assert.match(source, /if \(actor\.role !== "CUSTOMER"\) return messagingNotFound\(\);/, "only customers start");
  assert.match(source, /if \(after && result\.items\.length === 0\) return messagingNoContent\(\);/, "polling: 204 when nothing is new");
});

test("HTTP helpers: OFF gate 403 with code and Azerbaijani text; error mapping; 4 KB body cap; JSON only", async () => {
  const settings = (enabled: boolean) => async () => ({ enabled, allowContactDetails: false, limits: { ...MESSAGING_LIMIT_DEFAULTS } });
  const off = await messagingGate(settings(false));
  assert.ok("response" in off);
  assert.equal(off.response.status, 403);
  assert.deepEqual(await off.response.json(), { error: "Mesajlaşma hazırda əlçatan deyil.", code: MESSAGING_DISABLED_CODE });
  const on = await messagingGate(settings(true));
  assert.ok("settings" in on && on.settings.enabled);

  const expected = { DISABLED: 403, NOT_FOUND: 404, CONTEXT_INVALID: 404, STORE_UNAVAILABLE: 409, BLOCKED: 403, RATE_LIMITED: 429, INVALID_BODY: 422, INVALID: 422 } as const;
  for (const [code, status] of Object.entries(expected)) {
    const response = messagingErrorResponse(new MessagingError(code as keyof typeof expected, "Mətn"), "t");
    assert.equal(response.status, status, code);
    const body = await response.json();
    assert.equal(body.code, code);
    if (status === 404) assert.equal(body.error, "Söhbət tapılmadı.", "404 never says why");
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const original = console.error;
  console.error = () => undefined;
  try {
    const unexpected = messagingErrorResponse(new Error("db down: secret detail"), "t");
    assert.equal(unexpected.status, 503);
    assert.doesNotMatch(JSON.stringify(await unexpected.json()), /secret detail/);
  } finally {
    console.error = original;
  }

  const post = (body: string, type = "application/json") => new Request("https://x.invalid/api", { method: "POST", headers: { "content-type": type }, body });
  assert.equal((await readMessagingBody(post(JSON.stringify({ body: "x".repeat(4000) })))).ok, true);
  const big = await readMessagingBody(post(JSON.stringify({ body: "x".repeat(4100) })));
  assert.ok(!big.ok && big.response.status === 413);
  const text = await readMessagingBody(post("a=b", "text/plain"));
  assert.ok(!text.ok && text.response.status === 415);
  const array = await readMessagingBody(post("[1]"));
  assert.ok(!array.ok && array.response.status === 400);
});

test("polling: 15 s while there is news, 60 s after 5 quiet minutes, stop on 401/403/404/503", () => {
  const start = 1_000_000;
  assert.equal(nextPollDelay(start, start), 15_000);
  assert.equal(nextPollDelay(start, start + 4 * 60_000 + 59_999), 15_000);
  assert.equal(nextPollDelay(start, start + 5 * 60_000), 60_000);
  assert.deepEqual([...MESSAGE_POLL.stopStatuses], [401, 403, 404, 503]);
  for (const status of [401, 403, 404, 503]) assert.equal(isStopPollStatus(status), true, String(status));
  for (const status of [200, 204, 400, 422, 429, 500]) assert.equal(isStopPollStatus(status), false, String(status));
  assert.match(pollStopMessage(401), /Yenidən daxil olun/);
  // The client: no polling while hidden, an immediate check when visible again, 204 means nothing new.
  const thread = read("components/conversation-thread.tsx");
  assert.match(thread, /if \(stoppedRef\.current \|\| document\.visibilityState !== "visible"\) return;/);
  assert.match(thread, /if \(document\.visibilityState === "visible"\) void poll\(\)\.then\(schedule\);\n      else if \(timer\.current\) clearTimeout\(timer\.current\);/);
  assert.match(thread, /if \(response\.status === 204\) return false;\n      if \(isStopPollStatus\(response\.status\)\) \{ stop\(response\.status\); return false; \}/);
  assert.match(thread, /\}, nextPollDelay\(lastNewsAt\.current, Date\.now\(\)\)\);/);
});

test("plain-text rendering: message bodies are React text, never HTML", () => {
  for (const file of ["components/conversation-thread.tsx", "components/conversation-list.tsx", "components/message-composer.tsx", "app/(customer)/account/messages/[conversationId]/page.tsx", "app/vendor/[storeId]/messages/[conversationId]/page.tsx"]) {
    assert.doesNotMatch(read(file), /dangerouslySetInnerHTML|innerHTML/, file);
  }
  assert.match(read("components/conversation-thread.tsx"), /<p className="whitespace-pre-wrap break-words text-sm leading-6">\{message\.body\}<\/p>/);
});

test("links and entry rules: customers write, logged-out visitors sign in first (product page) or keep the form (store page)", () => {
  assert.equal(newConversationHref({ storeId: "s1", productId: "p1" }), "/account/messages/new?store=s1&product=p1");
  assert.equal(newConversationHref({ storeId: "s1", storeOrderId: "o1" }), "/account/messages/new?store=s1&order=o1");
  assert.equal(newConversationHref({ storeId: "s1" }), "/account/messages/new?store=s1");
  assert.equal(customerThreadHref("c1"), "/account/messages/c1");
  assert.equal(storeThreadHref("s1", "c1"), "/vendor/s1/messages/c1");
  assert.equal(storeThreadApi("s1", "c1"), "/api/vendor/s1/messages/c1");
  assert.equal(loginThenHref("/account/messages/new?store=s1"), "/login?next=%2Faccount%2Fmessages%2Fnew%3Fstore%3Ds1");
  const target = { storeId: "s1", productId: "p1" };
  assert.equal(messageEntryHref("CUSTOMER", target, "login"), "/account/messages/new?store=s1&product=p1");
  assert.equal(messageEntryHref(null, target, "login"), loginThenHref("/account/messages/new?store=s1&product=p1"));
  assert.equal(messageEntryHref(null, target, "hide"), null);
  assert.equal(messageEntryHref("VENDOR", target, "login"), null);
  assert.equal(messageEntryHref("ADMIN", target, "login"), null);
  // The notification e-mail links (phase 4) land on these pages.
  const service = read("lib/messaging-service.ts");
  assert.match(service, /`\/vendor\/\$\{encodeURIComponent\(input\.storeId\)\}\/messages\/\$\{encodeURIComponent\(input\.conversationId\)\}`/);
  assert.match(service, /`\/account\/messages\/\$\{encodeURIComponent\(input\.conversationId\)\}`/);
});

test("OFF hides every entry point and page", () => {
  const pages = read("lib/messaging-pages.ts");
  assert.match(pages, /const settings = await loadMessagingSettings\(\);\n  if \(!settings\.enabled\) notFound\(\);\n  return \{ user, settings \};/, "customer pages: 404 while OFF");
  assert.match(pages, /if \(!user \|\| user\.role !== "CUSTOMER"\) redirect\(`\/login\?next=\$\{encodeURIComponent\(nextPath\)\}`\);/);
  assert.match(pages, /export async function requireStoreMessagingEnabled\(\): Promise<MessagingSettings> \{\n  const settings = await loadMessagingSettings\(\);\n  if \(!settings\.enabled\) notFound\(\);/);
  assert.equal(pages.match(/if \(!settings\.enabled\) return null;/g)?.length, 3, "both badges and the entry buttons return null while OFF");
  for (const file of ["app/(customer)/account/messages/page.tsx", "app/(customer)/account/messages/[conversationId]/page.tsx", "app/(customer)/account/messages/new/page.tsx"]) {
    assert.match(read(file), /await requireCustomerMessagingPage\(/, file);
  }
  for (const file of ["app/vendor/[storeId]/messages/page.tsx", "app/vendor/[storeId]/messages/[conversationId]/page.tsx"]) {
    const source = read(file);
    const access = source.indexOf("await requireVendorStorePage(storeId)");
    const gate = source.indexOf("await requireStoreMessagingEnabled()");
    assert.ok(access > 0 && gate > access, `${file}: store access, then the switch`);
    assert.match(source, /const actor = \{ role: "STORE", userId: access\.user\.id, storeId: access\.storeId \} as const;/, `${file}: verified storeId`);
  }
  // Navigation: hidden unless a number is given.
  assert.match(read("components/account-navigation.tsx"), /const items = messagesUnread === null \? links : \[\.\.\.links\.slice\(0, 2\), messagesLink, \.\.\.links\.slice\(2\)\];/);
  assert.match(read("components/customer-account-menu.tsx"), /\.\.\.\(messagesUnread === null \? \[\] : \[\["\/account\/messages", "Mesajlarım"\]\]\)/);
  assert.match(read("components/vendor-navigation.tsx"), /\(path !== "messages" \|\| conversations !== null\)/);
  // DESIGN-POLISH-1: loaded together with the header cart count; still customers only, null otherwise.
  assert.match(read("app/(customer)/layout.tsx"), /const \[messagesUnread, cartCount\] = user\?\.role === "CUSTOMER"\s*\? await Promise\.all\(\[customerMessagesBadge\(user\.id\), /);
  assert.match(read("app/(customer)/layout.tsx"), /: \[null, null\];/);
  assert.match(read("app/vendor/[storeId]/layout.tsx"), /storeConversationsBadge\(access\.storeId, access\.user\.id\),/);
  assert.match(read("app/vendor/[storeId]/layout.tsx"), /conversations=\{conversations\}\/>/);
  // Entry buttons.
  assert.match(read("app/(customer)/products/[productId]/page.tsx"), /const askHref = await messageEntryForViewer\(\{ storeId: product\.store\.id, productId: product\.id \}, "login"\);/);
  assert.match(read("app/(customer)/products/[productId]/page.tsx"), /\{askHref && <Link href=\{askHref\}[^]*?Bu məhsul haqqında soruş<\/Link>\}/);
  assert.match(read("app/(customer)/stores/[storeId]/page.tsx"), /const messageHref = await messageEntryForViewer\(\{ storeId: store\.id \}, "hide"\);/);
  assert.match(read("app/(customer)/orders/[orderId]/page.tsx"), /\{messagingEnabled&&<Link href=\{newConversationHref\(\{storeId:group\.store\.id,storeOrderId:group\.id\}\)\}[^]*?>Mağazaya yaz<\/Link>\}/);
  // The store page keeps the anonymous form for everyone without a messageHref (logged out, sellers, OFF).
  const contact = read("components/storefront-contact.tsx");
  assert.match(contact, /\{info\.messageHref\n {10}\? <>/);
  assert.match(contact, /<StoreInquiryForm storeId=\{info\.storeId\} storeName=\{info\.storeName\}\/>/);
});

test("seller tab: Söhbətlər next to Mesajlar, unread badge from the layout query", () => {
  const nav = read("components/vendor-navigation.tsx");
  assert.match(nav, /\{ path: "inquiries", label: "Mesajlar", Icon: MessageSquare, badge: "inquiries" \},\n    \/\/ [^\n]*\n    \{ path: "messages", label: "Söhbətlər", Icon: MessagesSquare, badge: "conversations" \},/);
  assert.match(read("lib/messaging-pages.ts"), /return unreadConversationCount\(prisma, \{ role: "STORE", userId, storeId \}\)\.catch\(\(\) => 0\);/);
});
