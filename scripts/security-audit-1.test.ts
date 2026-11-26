/**
 * SECURITY-AUDIT-1: regression tests for the confirmed findings and one static guard.
 *  - M5: order creation is limited to 10 attempts per account and 60 per trusted client IP per hour (existing helpers,
 *    existing 429 text), counted after the body / terms checks and before any stock is touched.
 *  - L (cache): personal API JSON (/api/cart, /api/orders, /api/account, /api/vendor) is `Cache-Control: private, no-store`.
 *  - Discounts (verified safe, kept pinned): a campaign that would make a price <= 0 is ignored, the campaign API refuses
 *    >= 100 %, checkout refuses a unit price <= 0.
 *  - Order creation answers { order: { id } } only (SMALL-FIXES-1 A, re-verified live).
 *  - Static guard: new Prisma selections of account e-mails, contact e-mails, phones or password hashes in non-admin app/
 *    code must be reviewed and listed in scripts/sensitive-select-allowlist.json (how to extend: see "_how" there).
 * Live proof on 5433 (sec1_check): release-output/security-audit-1-report.md.
 * New modules are imported inside the tests so that, run against the code before the fix, each test fails on its own.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as formRateLimit from "../lib/form-rate-limit";
import { authRateLimitKey } from "../lib/auth-rate-limit";
import { RATE_LIMITED_MESSAGE } from "../lib/rate-limit-response";
import { orderCreateResponse } from "../lib/order-create-response";
import { calculateCampaignPrice, calculateEffectivePrice } from "../lib/promotion-pricing";
import { ALLOWED_ADMIN_API_ROUTES, isAllowedAdminChange } from "./admin-power-1-scope";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const BASE = "d83c84d";
// ABOUT-OWNER-INFO-2: the legal-page check compares this task's own commit (TASK) with BASE, not the working tree, so
// later owner-approved legal changes (2026-11-26: operator sentence moved, new date) do not break it.
const TASK = "aed4973";

const changedSinceBase = () => {
  try { return execFileSync("git", ["diff", "--name-only", BASE, TASK], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean); }
  catch { return null; }
};
const limits = formRateLimit as unknown as Record<string, { limit: number; windowMs: number } | undefined>;
const HOUR = 60 * 60 * 1000;

test("M5: order creation limits are 10 per account and 60 per trusted client IP per hour", () => {
  assert.deepEqual(limits.ORDER_CREATE_RATE_LIMIT, { limit: 10, windowMs: HOUR });
  assert.deepEqual(limits.ORDER_CREATE_IP_RATE_LIMIT, { limit: 60, windowMs: HOUR });
  // The scope exists in the key helper's union and gives its own keys (never shared with another scope).
  assert.match(read("lib/auth-rate-limit.ts"), /\| "order-create" \|/);
  const key = authRateLimitKey("order-create" as Parameters<typeof authRateLimitKey>[0], "user:u1");
  assert.notEqual(key, authRateLimitKey("order-receipt", "user:u1"));
});

test("M5: POST /api/orders checks the limits after the terms gate and before the order transaction, with the existing 429", () => {
  const route = read("app/api/orders/route.ts");
  const post = route.slice(route.indexOf("export async function POST"));
  const gate = post.indexOf("if(!termsGate.ok)");
  const limit = post.indexOf("withinFormRateLimits(");
  const refused = post.indexOf("if(!allowed)return rateLimitedResponse(60*60);");
  const transaction = post.indexOf("withOrderSerializationRetry(");
  assert.ok(gate > 0 && limit > gate && refused > limit && transaction > refused, "order: terms gate -> limits -> 429 -> transaction");
  assert.match(post, /\{scope:"order-create",identity:`user:\$\{user\.id\}`,\.\.\.ORDER_CREATE_RATE_LIMIT\}/);
  assert.match(post, /\.\.\.\(clientIp\?\[\{scope:"order-create" as const,identity:`ip:\$\{clientIp\}`,\.\.\.ORDER_CREATE_IP_RATE_LIMIT\}\]:\[\]\)/);
  assert.match(post, /const clientIp=trustedCloudflareClientIp\(request\.headers\);/);
  // No "open unpaid orders" limit (owner decision): every real order is unpaid until Epoint is live.
  assert.doesNotMatch(post, /order\.count\(\{where:\{userId/);
  assert.equal(RATE_LIMITED_MESSAGE, "Çox sayda cəhd edildi. Bir müddət sonra yenidən yoxlayın.");
});

test("M5: 10 attempts pass for one account, the 11th is refused; one IP passes 60 attempts across accounts, then 61st refused", async () => {
  const account = limits.ORDER_CREATE_RATE_LIMIT!, ip = limits.ORDER_CREATE_IP_RATE_LIMIT!;
  assert.ok(account && ip);
  const counts = new Map<string, number>();
  const deps = {
    consume: async (keyHash: string, limit: number) => { const next = (counts.get(keyHash) ?? 0) + 1; counts.set(keyHash, next); return next <= limit; },
    log: () => undefined,
  };
  const attempt = (user: string, clientIp: string | null) => formRateLimit.withinFormRateLimits([
    { scope: "order-create" as never, identity: `user:${user}`, ...account },
    ...(clientIp ? [{ scope: "order-create" as never, identity: `ip:${clientIp}`, ...ip }] : []),
  ], "test", deps);
  const one: boolean[] = [];
  for (let i = 0; i < 11; i++) one.push(await attempt("acc-1", "198.51.100.1"));
  assert.deepEqual(one, [...Array(10).fill(true), false]);
  // Carrier NAT: 6 accounts x 10 attempts share one IP -> all 60 pass; a 7th account on that IP is refused.
  const shared: boolean[] = [];
  for (let n = 2; n <= 7; n++) for (let i = 0; i < 10; i++) shared.push(await attempt(`acc-${n}`, "198.51.100.7"));
  assert.equal(shared.filter(Boolean).length, 60);
  assert.equal(await attempt("acc-8", "198.51.100.7"), false);
  assert.equal(await attempt("acc-8", "198.51.100.8"), true, "the same account from another IP is not blocked");
  // Without a trusted client IP only the account bucket applies.
  assert.equal(await attempt("acc-9", null), true);
});

test("L-cache: personal API paths are private, no-store; public catalog APIs are not in the list", async () => {
  const { isPersonalApiPath, PERSONAL_API_CACHE_CONTROL } = await import("../lib/personal-api-cache");
  assert.equal(PERSONAL_API_CACHE_CONTROL, "private, no-store");
  for (const path of ["/api/cart", "/api/cart/items/x", "/api/orders", "/api/orders/o1/cancel", "/api/account/addresses", "/api/account/messages/c1", "/api/vendor/s1/orders", "/api/vendor/stores"]) assert.equal(isPersonalApiPath(path), true, path);
  for (const path of ["/api/products", "/api/products/p1", "/api/stores", "/api/categories", "/api/cities", "/api/cartography", "/api/admin/orders", "/api/auth/login", "/cart", "/orders"]) assert.equal(isPersonalApiPath(path), false, path);
  const middleware = read("middleware.ts");
  assert.match(middleware, /if \(isPersonalApiPath\(pathname\)\) response\.headers\.set\("Cache-Control", PERSONAL_API_CACHE_CONTROL\);/);
  // The header is set on the pass-through response, after the CSRF rejection (which is already no-store).
  assert.ok(middleware.indexOf("isPersonalApiPath(pathname)") > middleware.indexOf("const response = NextResponse.next("));
});

test("order creation answers only { order: { id } }, even when handed the full order with seller data", () => {
  const full = { id: "o1", storeOrders: [{ store: { vendor: { user: { id: "u", email: "seller@example.invalid" } } } }], addressSnapshot: { phone: "+994500000000" } };
  assert.deepEqual(orderCreateResponse(full), { order: { id: "o1" } });
  assert.match(read("app/api/orders/route.ts"), /return NextResponse\.json\(orderCreateResponse\(order as SellerOrderEmailOrder\),\{status:201\}\);/);
});

test("discounts: no campaign can make a price <= 0; the API refuses >= 100 %; checkout refuses a unit price <= 0", () => {
  for (const value of [100, 150, 99.999]) assert.equal(calculateCampaignPrice(20, "PERCENT", value), null, `PERCENT ${value}`);
  for (const value of [20, 25]) assert.equal(calculateCampaignPrice(20, "FIXED", value), null, `FIXED ${value}`);
  assert.equal(calculateCampaignPrice(20, "PERCENT", 10)?.toFixed(2), "18.00");
  const promotion = { id: "p", name: "Yüz əlli faiz", startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 100000), isActive: true, discountType: "PERCENT", discountValue: 150 };
  const effective = calculateEffectivePrice(20, null, [promotion]);
  assert.equal(effective.unitPrice.toFixed(2), "20.00");
  assert.equal(effective.promotion, null);
  assert.match(read("app/api/vendor/[storeId]/campaigns/route.ts"), /if \(value\.discountType === "PERCENT" && value\.discountValue >= 100\) return NextResponse\.json\(\{ error: "Faiz endirimi 100%-dən az olmalıdır" \}, \{ status: 422 \}\);/g);
  assert.match(read("app/api/orders/route.ts"), /if\(!price\.isFinite\(\)\|\|price\.lte\(0\)\|\|!unitPrice\.isFinite\(\)\|\|unitPrice\.lte\(0\)\)throw new Error\("PRICE_INVALID"\)/);
});

type Allow = { entries: Record<string, { count: number; reason: string }> };
const SENSITIVE: Record<string, RegExp> = {
  "email:true": /\bemail\s*:\s*true\b/g,
  "contactEmail:true": /\bcontactEmail\s*:\s*true\b/g,
  "phone:true": /\b(?:phone|contactPhone)\s*:\s*true\b/g,
  passwordHash: /\bpasswordHash\b/g,
};
function sourceFiles(dir: string, out: string[] = []) {
  for (const name of readdirSync(join(root, dir))) {
    const path = `${dir}/${name}`;
    if (statSync(join(root, path)).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

test("static guard: sensitive Prisma selections in non-admin app/ code are reviewed and allow-listed", () => {
  const allow = JSON.parse(read("scripts/sensitive-select-allowlist.json")) as Allow;
  for (const [key, entry] of Object.entries(allow.entries)) assert.ok(entry.reason.length > 20 && entry.count > 0, `allow-list entry needs a count and a reason: ${key}`);
  const problems: string[] = [];
  for (const file of sourceFiles("app")) {
    if (file.startsWith("app/admin/") || file.startsWith("app/api/admin/")) continue;
    const text = read(file);
    for (const [name, pattern] of Object.entries(SENSITIVE)) {
      const count = (text.match(pattern) ?? []).length;
      const allowed = allow.entries[`${file} ${name}`]?.count ?? 0;
      if (count > allowed) problems.push(`${file}: ${count} x ${name} (allow-listed: ${allowed}). Return an allow-listed DTO, or review and extend scripts/sensitive-select-allowlist.json.`);
    }
  }
  assert.deepEqual(problems, []);
});

test("static guard catches a new selection (self-check of the scanner)", () => {
  const sample = 'const x = await db.order.findMany({ include: { user: { select: { email: true, passwordHash: true } }, store: { select: { contactPhone: true } } } });';
  assert.equal((sample.match(SENSITIVE["email:true"]) ?? []).length, 1);
  assert.equal((sample.match(SENSITIVE.passwordHash) ?? []).length, 1);
  assert.equal((sample.match(SENSITIVE["phone:true"]) ?? []).length, 1);
});

test("admin pages, admin APIs and legal pages are untouched by this task", () => {
  const changed = changedSinceBase();
  if (!changed) return; // no git history available (exported copy): nothing to compare
  // ADMIN-DESIGN-1 / ADMIN-POWER-1 (owner-approved): their listed admin UI files may change; admin APIs stay forbidden
  // except the two new ADMIN-POWER-1 routes (search, list export) and ADMIN-DESIGN-2's two q-filter escapes (products
  // export, import store picker), pinned by scripts/admin-power-1.test.ts and scripts/admin-design-2.test.ts.
  const forbidden = changed.filter((file) => ((file.startsWith("app/admin/") || /^components\/admin/.test(file)) && !isAllowedAdminChange(file)) || (file.startsWith("app/api/admin/") && !ALLOWED_ADMIN_API_ROUTES.includes(file))
    // SEO-TITLES-1 (owner-approved): /delivery-returns gained only a <title>/canonical; its visible content is pinned as
    // unchanged by scripts/seo-titles-1.test.ts. The three legal pages stay fully untouched.
    || /^app\/\(customer\)\/(terms|privacy|seller-terms)\//.test(file) || file.startsWith("lib/legal"));
  assert.deepEqual(forbidden, []);
});
