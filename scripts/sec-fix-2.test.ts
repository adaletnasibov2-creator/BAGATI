/**
 * SEC-FIX-2: L6 JSON body caps, L8 rate limits, L5 seller tracking e-mails. Unit tests only: in-memory stand-ins
 * replace the database (no Prisma call is made); request handlers are called only where they answer before any
 * session or database step, or take injected dependencies. Everything else is checked in the source.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { BODY_TOO_LARGE_MESSAGE, bodyTooLargeResponse, JSON_BODY_LIMITS, JsonBodyTooLargeError, readJsonCapped } from "../lib/json-body";
import { allowPublicSearch, emptySearchPage, limitedSearch, PUBLIC_SEARCH_IP_LIMIT, PUBLIC_SEARCH_PROCESS_LIMIT } from "../lib/public-search-rate-limit";
import { RATE_LIMITED_MESSAGE, rateLimitedResponse } from "../lib/rate-limit-response";
import {
  EPOINT_RECONCILE_IP_RATE_LIMIT, EPOINT_RECONCILE_RATE_LIMIT, SHIPMENT_EMAIL_ORDER_LIMIT, SHIPMENT_EMAIL_STORE_LIMIT,
  SUPPORT_IP_RATE_LIMIT, SUPPORT_RATE_LIMIT, withinFormRateLimits, type FormRateLimitDeps,
} from "../lib/form-rate-limit";
import { shipmentEmailAllowed } from "../lib/shipment-email-guard";
import { authRateLimitKey, consumeAuthProcessRateLimit } from "../lib/auth-rate-limit";
import { handleCompleteGoogleRegister } from "../lib/google-complete-register";
import { handleVerifyEmail } from "../lib/email-verification-route";
import { GET as productsApi } from "../app/api/products/route";
import { GET as productsCursorApi } from "../app/api/products/cursor/route";
import { GET as storesCursorApi } from "../app/api/stores/cursor/route";
import { GET as storeOptionsApi } from "../app/api/store-options/route";

// Throwaway test value (read when the functions run).
process.env.SESSION_SECRET ??= "sec-fix-2-unit-test-secret-0123456789abcdef-xyz";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const BASE = "1b25b32"; // main before SEC-FIX-2

function jsonRequest(body: string, options: { contentLength?: boolean; url?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000", ...options.headers };
  if (options.contentLength !== false) headers["content-length"] = String(Buffer.byteLength(body));
  return new Request(options.url ?? "http://localhost:3000/api/x", { method: "POST", headers, body, ...(options.contentLength === false ? { duplex: "half" } : {}) } as RequestInit);
}
/** A body without Content-Length, delivered in chunks (the streamed-bytes path). */
function streamedRequest(totalBytes: number) {
  const chunk = new TextEncoder().encode(`"${"a".repeat(1022)}",`);
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) { controller.close(); return; }
      controller.enqueue(chunk); sent += chunk.byteLength;
    },
  });
  return new Request("http://localhost:3000/api/x", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
}

// ================================================================= L6: the reader

test("L6 reader: under the cap parses like request.json(); over the cap (declared or streamed) is a 413 with the existing text", async () => {
  assert.deepEqual(await readJsonCapped(jsonRequest(JSON.stringify({ a: 1, t: "Bakı" })), 1024), { a: 1, t: "Bakı" });
  // Exactly at the cap is allowed.
  const exact = JSON.stringify({ t: "x".repeat(1024 - 8) });
  assert.equal(Buffer.byteLength(exact), 1024);
  assert.deepEqual(await readJsonCapped(jsonRequest(exact), 1024), JSON.parse(exact));
  // One byte over: refused from Content-Length, before reading.
  await assert.rejects(readJsonCapped(jsonRequest(JSON.stringify({ t: "x".repeat(1024 - 7) })), 1024), JsonBodyTooLargeError);
  // No Content-Length: refused while streaming (stops after the cap, does not buffer the rest).
  await assert.rejects(readJsonCapped(streamedRequest(10 * 1024 * 1024), 16 * 1024), JsonBodyTooLargeError);
  // Bad JSON stays a SyntaxError, so each route keeps its own 400.
  await assert.rejects(readJsonCapped(jsonRequest("{not json"), 1024), SyntaxError);
  const tooLarge = bodyTooLargeResponse(new JsonBodyTooLargeError());
  assert.equal(tooLarge?.status, 413);
  assert.deepEqual(await tooLarge?.json(), { error: BODY_TOO_LARGE_MESSAGE, code: "BODY_TOO_LARGE" });
  assert.equal(bodyTooLargeResponse(new SyntaxError("x")), null);
});

const CAPPED: Array<[string, number]> = [
  ["app/api/account/addresses/[addressId]/route.ts", 1], ["app/api/account/addresses/route.ts", 1], ["app/api/account/profile/route.ts", 1],
  ["app/api/account/returns/route.ts", 2], ["app/api/account/security/password/route.ts", 1], ["app/api/admin/[...resource]/route.ts", 3],
  ["app/api/admin/email/route.ts", 1], ["app/api/admin/homepage/banners/[bannerId]/route.ts", 1], ["app/api/admin/homepage/banners/route.ts", 1],
  ["app/api/admin/homepage/featured/route.ts", 1], ["app/api/admin/login/route.ts", 1], ["app/api/admin/products/[productId]/route.ts", 1],
  ["app/api/admin/promotions/route.ts", 2], ["app/api/admin/returns/route.ts", 1], ["app/api/admin/site-settings/route.ts", 1],
  ["app/api/admin/stores/[storeId]/activation/route.ts", 1], ["app/api/admin/stores/[storeId]/assets/route.ts", 1],
  ["app/api/admin/stores/[storeId]/complimentary/route.ts", 1], ["app/api/admin/stores/[storeId]/review/route.ts", 1], ["app/api/admin/vendors/route.ts", 1],
  ["app/api/auth/forgot-password/route.ts", 1], ["app/api/auth/google/link/route.ts", 1], ["app/api/auth/login/route.ts", 1], ["app/api/auth/register/route.ts", 1],
  ["app/api/auth/reset-password/route.ts", 1], ["app/api/auth/vendor-login/route.ts", 1], ["app/api/cart/items/[itemId]/route.ts", 1], ["app/api/cart/items/route.ts", 1],
  ["app/api/orders/[orderId]/cancellation-requests/[requestId]/route.ts", 1], ["app/api/orders/[orderId]/cancellation-requests/route.ts", 1],
  ["app/api/orders/route.ts", 1], ["app/api/payments/epoint/initiate/route.ts", 1], ["app/api/payments/epoint/reconcile/route.ts", 1], ["app/api/support/route.ts", 1],
  ["app/api/vendor/[storeId]/[section]/route.ts", 2], ["app/api/vendor/[storeId]/assets/route.ts", 1], ["app/api/vendor/[storeId]/campaigns/route.ts", 2],
  ["app/api/vendor/[storeId]/cancellation-requests/[requestId]/route.ts", 1], ["app/api/vendor/[storeId]/inquiries/route.ts", 1],
  ["app/api/vendor/[storeId]/products/[productId]/route.ts", 1], ["app/api/vendor/[storeId]/products/route.ts", 1], ["app/api/vendor/[storeId]/returns/route.ts", 1],
  ["app/api/vendor/stores/route.ts", 1], ["lib/admin-category-route.ts", 1], ["lib/email-verification-route.ts", 1], ["lib/google-complete-register.ts", 1],
];

function sourceFiles(dirs = ["app", "lib", "components"]) {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) files.push(relative(root, full).replace(/\\/g, "/"));
    }
  };
  for (const dir of dirs) walk(resolve(root, dir));
  return files;
}

test("L6 inventory: every route from the inventory reads its body through the cap and answers 413 over it", () => {
  for (const [path, count] of CAPPED) {
    const source = read(path);
    assert.equal(source.match(/readJsonCapped\((?:request|req), ?/g)?.length, count, path);
    assert.equal(source.match(/bodyTooLargeResponse\(error\)/g)?.length, count, `${path}: 413 on every read`);
    assert.doesNotMatch(source, /\b(?:request|req)\.json\(\)/, path);
  }
  // Nothing in app/ or lib/ reads an uncapped JSON body any more (lib/json-body.ts only names it in a comment).
  const offenders = sourceFiles(["app", "lib"]).filter(path => path !== "lib/json-body.ts" && /\b(?:request|req)\.(?:json|formData|text|arrayBuffer|blob)\(\)/.test(read(path)));
  assert.deepEqual(offenders, []);
});

test("L6 caps per route match the inventory (never below what the UI sends)", () => {
  const limitOf = (path: string) => [...read(path).matchAll(/readJsonCapped\((?:request|req), ?([^)]+)\)/g)].map(m => m[1].trim());
  for (const path of ["app/api/auth/login/route.ts", "app/api/auth/register/route.ts", "app/api/cart/items/route.ts", "app/api/payments/epoint/reconcile/route.ts", "app/api/account/addresses/route.ts"]) {
    assert.deepEqual(limitOf(path), ["JSON_BODY_LIMITS.small"], path);
  }
  for (const path of ["app/api/orders/route.ts", "app/api/support/route.ts", "app/api/vendor/stores/route.ts"]) assert.deepEqual(limitOf(path), ["JSON_BODY_LIMITS.medium"], path);
  assert.deepEqual(limitOf("app/api/vendor/[storeId]/products/route.ts"), ["JSON_BODY_LIMITS.product"]);
  assert.deepEqual(limitOf("app/api/vendor/[storeId]/products/[productId]/route.ts"), ["JSON_BODY_LIMITS.product"]);
  assert.deepEqual(limitOf("app/api/admin/products/[productId]/route.ts"), ["JSON_BODY_LIMITS.large"]);
  assert.deepEqual(limitOf("app/api/vendor/[storeId]/[section]/route.ts"), ['section==="imports"?JSON_BODY_LIMITS.legacyImport:JSON_BODY_LIMITS.medium', "JSON_BODY_LIMITS.medium"]);
  assert.deepEqual(JSON_BODY_LIMITS, { small: 16384, medium: 65536, large: 262144, product: 1048576, legacyImport: 25165824 });
});

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
test("L6 real-user payloads fit: the largest the UI/schema allows is under each route's cap", () => {
  // Checkout: 500 expected prices (schema max).
  assert.ok(bytes({ addressId: "c".repeat(25), acceptTerms: true, expectedPrices: Array.from({ length: 500 }, (_, i) => ({ cartItemId: `cmwt1cg39000cb7cczqfn${i}`, unitPrice: 123456.78 })) }) < JSON_BODY_LIMITS.medium);
  // Support: 5000-char message with Azerbaijani letters, quotes and new lines.
  assert.ok(bytes({ subject: "ə".repeat(160), message: "Səbət \"ödəniş\"\n".repeat(400).slice(0, 5000) }) < JSON_BODY_LIMITS.medium);
  // Customer return: 2000-char reason, every char escaped (worst case).
  assert.ok(bytes({ storeOrderItemId: "x".repeat(30), quantity: 1, reason: "\u0001".repeat(2000) }) < JSON_BODY_LIMITS.medium);
  // Seller product: schema maximum — 100 variants × 12 image URLs of 500 chars, 5000-char description, options.
  const url = `https://cdn.example/${"p".repeat(480)}.webp`;
  const variant = { name: "v".repeat(100), options: { Rəng: "Qırmızı", Ölçü: "XL" }, sku: "SKU-123456", isActive: true, price: 10, discountPrice: 9, images: Array(12).fill(url), quantity: 5, lowStockThreshold: 1 };
  const product = { name: "n".repeat(160), description: "ə".repeat(5000), price: 10, images: Array(12).fill(url), variants: Array(100).fill(variant), status: "ACTIVE" };
  assert.ok(bytes(product) > JSON_BODY_LIMITS.large, "the schema worst case is bigger than 256 KB, so 256 KB would be too small");
  assert.ok(bytes(product) < JSON_BODY_LIMITS.product);
  // Legacy seller import: 1000 rows parsed from a ~10 MB file (20 columns).
  const row = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`Sütun adı ${i}`, "d".repeat(480)]));
  assert.ok(bytes({ action: "import", mode: "create", sourceName: "fayl.xlsx", mapping: { name: "Sütun adı 0" }, rows: Array(1000).fill(row) }) < JSON_BODY_LIMITS.legacyImport);
  // Login-type forms are tiny.
  assert.ok(bytes({ email: `${"a".repeat(240)}@x.az`, password: "p".repeat(128) }) < JSON_BODY_LIMITS.small);
});

test("L6 handlers: complete-register and verify-email answer 413 over the cap and work under it", async () => {
  const deps = {
    readToken: async () => undefined,
    rateLimitAllowed: async () => true,
    accountExists: async () => false,
    createAccount: async () => ({ id: "u" }),
    createSession: async () => ({ name: "s", value: "v", httpOnly: true, secure: false, sameSite: "lax" as const, path: "/", maxAge: 1 }),
    log: () => {},
  };
  const big = await handleCompleteGoogleRegister(jsonRequest(JSON.stringify({ acceptTerms: true, pad: "x".repeat(JSON_BODY_LIMITS.small) })), deps);
  assert.equal(big.status, 413);
  assert.deepEqual(await big.json(), { error: BODY_TOO_LARGE_MESSAGE, code: "BODY_TOO_LARGE" });
  const normal = await handleCompleteGoogleRegister(jsonRequest(JSON.stringify({ acceptTerms: true })), deps);
  assert.equal(normal.status, 400, "normal size goes on to the cookie check (no cookie here)");
  assert.equal((await normal.json()).code, "invalid");

  let dbCalls = 0;
  const db = { user: { findFirst: async () => { dbCalls += 1; return { id: "u1" }; } }, emailVerification: { findUnique: async () => null, updateMany: async () => ({ count: 0 }) } };
  const verifyDeps = { db, readContext: async () => ({ userId: "u1", role: "CUSTOMER" as const }), clearContext: async () => {}, createSession: async () => ({}), enqueueEmail: async () => {} } as unknown as Parameters<typeof handleVerifyEmail>[1];
  const tooBig = await handleVerifyEmail(jsonRequest(JSON.stringify({ code: "123456", pad: "x".repeat(20_000) })), verifyDeps);
  assert.equal(tooBig.status, 413);
  const badCode = await handleVerifyEmail(jsonRequest(JSON.stringify({ code: "12" })), verifyDeps);
  assert.equal(badCode.status, 400, "a normal (invalid) code still gets the route's own answer");
  assert.equal(dbCalls, 2);
});

// ================================================================= L8: public search (in-process only)

function countingLimiter() {
  const buckets = new Map<string, number>();
  const calls: string[] = [];
  const consume = (key: string, limit: number) => { calls.push(key); const next = (buckets.get(key) ?? 0) + 1; buckets.set(key, next); return next <= limit; };
  return { consume, calls, buckets };
}
const ipHeaders = (ip: string) => new Headers({ "cf-connecting-ip": ip });

test("L8 search: 120 per minute per trusted IP pass, the 121st is refused; other IPs are not affected", () => {
  process.env.BAGATI_TRUST_CLOUDFLARE_IP = "true";
  try {
    const limiter = countingLimiter();
    for (let i = 0; i < PUBLIC_SEARCH_IP_LIMIT.limit; i += 1) assert.equal(allowPublicSearch(ipHeaders("203.0.113.7"), limiter.consume), true, `call ${i + 1}`);
    assert.equal(allowPublicSearch(ipHeaders("203.0.113.7"), limiter.consume), false, "the 121st");
    assert.equal(allowPublicSearch(ipHeaders("198.51.100.9"), limiter.consume), true, "another visitor");
    assert.deepEqual([...limiter.buckets.keys()].sort(), ["public-search:ip:198.51.100.9", "public-search:ip:203.0.113.7", "public-search:process"]);
  } finally { delete process.env.BAGATI_TRUST_CLOUDFLARE_IP; }
});

test("L8 search: without a trusted client IP only the process-wide 3000 / minute applies", () => {
  const limiter = countingLimiter();
  for (let i = 0; i < PUBLIC_SEARCH_PROCESS_LIMIT.limit; i += 1) assert.equal(allowPublicSearch(ipHeaders("203.0.113.7"), limiter.consume), true);
  assert.equal(allowPublicSearch(new Headers(), limiter.consume), false, "the 3001st");
  assert.deepEqual([...limiter.buckets.keys()], ["public-search:process"], "the untrusted header is ignored");
});

test("L8 search: the limiter makes no database call (in-process map only)", () => {
  const source = read("lib/public-search-rate-limit.ts");
  assert.doesNotMatch(source, /prisma|consumeAuthRateLimit\b|\$queryRaw|\$executeRaw/);
  assert.match(source, /consume: ProcessLimiter = consumeAuthProcessRateLimit/);
  // The real in-process limiter is synchronous (no promise, so no I/O).
  assert.equal(typeof consumeAuthProcessRateLimit("sec-fix-2:probe", 1, 60_000), "boolean");
  // A stand-in that would throw on any DB-like use is enough: only the consume function is ever called.
  const limiter = countingLimiter();
  allowPublicSearch(new Headers(), limiter.consume);
  assert.deepEqual(limiter.calls, ["public-search:process"]);
});

test("L8 search pages: over the budget the search query is not run at all; under it, it runs unchanged", async () => {
  let runs = 0;
  const run = async () => { runs += 1; return { items: [1, 2], pageSize: 2, hasNext: true, hasPrevious: false, nextCursor: "n", previousCursor: null }; };
  assert.deepEqual(await limitedSearch(false, run), { items: [1, 2], pageSize: 2, hasNext: true, hasPrevious: false, nextCursor: "n", previousCursor: null });
  assert.equal(runs, 1);
  assert.deepEqual(await limitedSearch(true, run), emptySearchPage());
  assert.equal(runs, 1, "no query when limited");
  for (const path of ["app/(customer)/products/(list)/page.tsx", "app/(customer)/stores/page.tsx"]) {
    const source = read(path);
    assert.match(source, /const searchLimited = Boolean\((searchQuery|q)\) && !allowPublicSearch\(await headers\(\)\);/, path);
    assert.match(source, /limitedSearch\(searchLimited, \(\) => /, path);
    assert.match(source, /\{searchLimited && <p role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">\{RATE_LIMITED_MESSAGE\}<\/p>\}/, path);
  }
});

test("L8 search APIs: the guard is the first step and answers 429 with the existing text before any DB call", async () => {
  for (const path of ["app/api/products/route.ts", "app/api/products/cursor/route.ts", "app/api/stores/cursor/route.ts", "app/api/store-options/route.ts"]) {
    assert.match(read(path), /export async function GET\(request: NextRequest\) \{\n  \/\/ SEC-FIX-2 L8[^\n]*\n  if \(!allowPublicSearch\(request\.headers\)\) return rateLimitedResponse\(60\);/, path);
  }
  // Use up this test process's whole budget, then call the real handlers: they must refuse without touching the DB
  // (DATABASE_URL is not used: a DB call here would fail the test with a connection error, not a 429).
  while (consumeAuthProcessRateLimit("public-search:process", PUBLIC_SEARCH_PROCESS_LIMIT.limit, PUBLIC_SEARCH_PROCESS_LIMIT.windowMs)) { /* fill */ }
  for (const [name, handler, url] of [
    ["products", productsApi, "http://localhost:3000/api/products?q=fincan"],
    ["products cursor", productsCursorApi, "http://localhost:3000/api/products/cursor?q=fincan"],
    ["stores cursor", storesCursorApi, "http://localhost:3000/api/stores/cursor?q=gence"],
    ["store options", storeOptionsApi, "http://localhost:3000/api/store-options?q=gence"],
  ] as const) {
    const response = await handler(new NextRequest(url));
    assert.equal(response.status, 429, name);
    assert.deepEqual(await response.json(), { error: RATE_LIMITED_MESSAGE, message: RATE_LIMITED_MESSAGE, code: "RATE_LIMITED" }, name);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

// ================================================================= L8: DB-backed form limits (stand-in store)

function memoryStore(options: { fail?: boolean } = {}) {
  const counts = new Map<string, number>();
  const logs: string[] = [];
  const deps: FormRateLimitDeps = {
    consume: async (key, limit) => { if (options.fail) throw Object.assign(new Error("db down"), { code: "P1001" }); const next = (counts.get(key) ?? 0) + 1; counts.set(key, next); return next <= limit; },
    log: (stage) => { logs.push(stage); },
  };
  return { deps, counts, logs };
}

test("L8 support: 5 per account pass, the 6th is refused; the per-IP bucket (20) also applies", async () => {
  const store = memoryStore();
  const buckets = (user: string, ip?: string) => [
    { scope: "support" as const, identity: `user:${user}`, ...SUPPORT_RATE_LIMIT },
    ...(ip ? [{ scope: "support" as const, identity: `ip:${ip}`, ...SUPPORT_IP_RATE_LIMIT }] : []),
  ];
  for (let i = 0; i < 5; i += 1) assert.equal(await withinFormRateLimits(buckets("u1"), "t", store.deps), true);
  assert.equal(await withinFormRateLimits(buckets("u1"), "t", store.deps), false, "6th");
  // 20 different accounts from one IP: the 21st is refused by the IP bucket.
  let refused = 0;
  for (let i = 0; i < 21; i += 1) if (!(await withinFormRateLimits(buckets(`acc-${i}`, "203.0.113.7"), "t", store.deps))) refused += 1;
  assert.equal(refused, 1);
  assert.deepEqual([SUPPORT_RATE_LIMIT.limit, SUPPORT_RATE_LIMIT.windowMs, SUPPORT_IP_RATE_LIMIT.limit], [5, 900_000, 20]);
});

test("L8 Epoint reconcile: 20 per account per 10 min pass, the 21st is refused", async () => {
  const store = memoryStore();
  const bucket = [{ scope: "epoint-reconcile" as const, identity: "user:c1", ...EPOINT_RECONCILE_RATE_LIMIT }];
  for (let i = 0; i < 20; i += 1) assert.equal(await withinFormRateLimits(bucket, "t", store.deps), true);
  assert.equal(await withinFormRateLimits(bucket, "t", store.deps), false);
  assert.deepEqual([EPOINT_RECONCILE_RATE_LIMIT.windowMs, EPOINT_RECONCILE_IP_RATE_LIMIT.limit], [600_000, 60]);
});

test("L8 a failing rate-limit store does not lock the form, and is logged (never silent)", async () => {
  const store = memoryStore({ fail: true });
  assert.equal(await withinFormRateLimits([{ scope: "support", identity: "user:u1", ...SUPPORT_RATE_LIMIT }], "support_rate_limit", store.deps), true);
  assert.deepEqual(store.logs, ["support_rate_limit"]);
});

test("L8 keys are HMACs (no raw id or IP stored) and the new scope names exist", () => {
  for (const scope of ["support", "epoint-reconcile", "shipment-email"] as const) assert.match(authRateLimitKey(scope, "ip:203.0.113.7"), /^[0-9a-f]{64}$/);
  assert.match(read("lib/auth-rate-limit.ts"), /\| "google-complete-register" \| "support" \| "epoint-reconcile" \| "shipment-email" \|/);
});

test("L8 routes: support and reconcile check their limits before the costly step; verify-token is in-process", () => {
  const support = read("app/api/support/route.ts");
  assert.ok(support.indexOf("withinFormRateLimits(") > support.indexOf("if (!parsed.success)") && support.indexOf("withinFormRateLimits(") < support.indexOf("prisma.supportTicket.create("));
  assert.match(support, /if \(!allowed\) return rateLimitedResponse\(15 \* 60\);/);
  const reconcile = read("app/api/payments/epoint/reconcile/route.ts");
  assert.ok(reconcile.indexOf("withinFormRateLimits(") < reconcile.indexOf("reconcileOwnedOrder(user.id"));
  assert.match(reconcile, /if \(!allowed\) return rateLimitedResponse\(10 \* 60\);/);
  const verify = read("app/api/store-notification-email/verify/route.ts");
  assert.ok(verify.indexOf("consumeAuthProcessRateLimit(") < verify.indexOf("verifyNotificationEmailToken("));
  assert.doesNotMatch(verify, /consumeAuthRateLimit\(/, "no DB write per guest call");
});

test("L8 response: 429 with the existing text; the client of reconcile shows `message`, which is the same text", async () => {
  const response = rateLimitedResponse(60);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.deepEqual(await response.json(), { error: RATE_LIMITED_MESSAGE, message: RATE_LIMITED_MESSAGE, code: "RATE_LIMITED" });
  assert.match(read("components/epoint-return-check.tsx"), /setMessage\(data\.message \|\|/);
});

// ================================================================= L5: seller tracking e-mails

test("L5 tracking e-mails: 10 per store order pass, the 11th is skipped; never for a closed order", async () => {
  const store = memoryStore();
  const input = { storeId: "s1", storeOrderId: "so1", orderStatus: "SHIPPED" };
  for (let i = 0; i < SHIPMENT_EMAIL_ORDER_LIMIT.limit; i += 1) assert.equal(await shipmentEmailAllowed(input, store.deps), true, `e-mail ${i + 1}`);
  assert.equal(await shipmentEmailAllowed(input, store.deps), false, "the 11th");
  assert.equal(await shipmentEmailAllowed({ ...input, storeOrderId: "so2" }, store.deps), true, "another order of the store");
  const before = [...store.counts.values()].reduce((a, b) => a + b, 0);
  for (const closed of ["CANCELLED", "RETURNED"]) assert.equal(await shipmentEmailAllowed({ ...input, storeOrderId: "so3", orderStatus: closed }, store.deps), false, closed);
  assert.equal([...store.counts.values()].reduce((a, b) => a + b, 0), before, "a closed order uses no counter");
});

test("L5 tracking e-mails: at most 200 per store per hour across its orders", async () => {
  const store = memoryStore();
  let sent = 0;
  for (let i = 0; i < 201; i += 1) if (await shipmentEmailAllowed({ storeId: "busy", storeOrderId: `so-${i}`, orderStatus: "PROCESSING" }, store.deps)) sent += 1;
  assert.equal(sent, SHIPMENT_EMAIL_STORE_LIMIT.limit);
});

test("L5 route: the e-mail goes only to this order's customer, only when allowed; the tracking data is saved regardless", () => {
  const route = read("app/api/vendor/[storeId]/[section]/route.ts");
  const branch = route.slice(route.indexOf('if(section==="orders"){'), route.indexOf('if(section==="products"){'));
  assert.match(branch, /const order=await tx\.order\.findUnique\(\{where:\{id:locked\.orderId\},select:\{id:true,user:\{select:\{email:true\}\}\}\}\);/);
  assert.match(branch, /if\(trackingChanged&&\(trackingCode\|\|trackingUrl\)&&await shipmentEmailAllowed\(\{storeId,storeOrderId:locked\.id,orderStatus:targetOrderStatus\?\?locked\.status\}\)\)\{\n\s+await enqueueEmail\(tx,\{eventKey:`shipment-update:\$\{locked\.id\}/);
  assert.match(branch, /template:"SHIPMENT_UPDATE",payload/);
  assert.equal(branch.match(/recipient:order\.user\.email/g)?.length, 2, "order-status and shipment e-mails both go to the order's customer");
  // The data update happens before (and independently of) the e-mail decision.
  assert.ok(branch.indexOf("tx.storeOrder.updateMany(") < branch.indexOf("shipmentEmailAllowed("));
});

// ================================================================= texts

test("texts: only existing texts are used; no other new Azerbaijani text (diff scan against main)", () => {
  const baseText = (path: string) => { try { return execFileSync("git", ["show", `${BASE}:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).replace(/\r\n/g, "\n"); } catch { return ""; } };
  // The two texts exist before this change.
  assert.ok(baseText("app/api/auth/reset-password/route.ts").includes(RATE_LIMITED_MESSAGE));
  assert.ok(baseText("lib/catalog-import-job-route.ts").includes(BODY_TOO_LARGE_MESSAGE));
  const changed = execFileSync("git", ["diff", "--name-only", BASE, "--", "app", "lib", "components"], { cwd: root, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "--", "app", "lib", "components"], { cwd: root, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  const files = [...new Set([...changed, ...untracked])].filter(path => /\.(ts|tsx)$/.test(path));
  assert.ok(files.length >= 50, `changed files found: ${files.length}`);
  const AZ = /[əğıöüşçƏĞİÖÜŞÇ]/;
  const fragments = (source: string) => new Set(source.split(/["'`<>{}]|\$\{/).map(part => part.trim()).filter(part => AZ.test(part)));
  for (const path of files) {
    const before = fragments(baseText(path));
    for (const fragment of fragments(read(path))) {
      if (before.has(fragment)) continue;
      const rest = fragment.split(RATE_LIMITED_MESSAGE).join("").split(BODY_TOO_LARGE_MESSAGE).join("");
      assert.doesNotMatch(rest, AZ, `${path}: new text: ${fragment}`);
    }
  }
  for (const path of ["app/(customer)/terms/page.tsx", "app/(customer)/privacy/page.tsx", "app/(customer)/seller-terms/page.tsx"]) assert.equal(read(path), baseText(path), path);
});
