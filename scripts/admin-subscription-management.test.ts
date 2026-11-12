import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertFeature, hasFeature, resolveStoreEntitlements } from "../lib/subscription-entitlements";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const active = { adminManaged: false, storeStatus: "ACTIVE", storeActive: true, vendorActive: true, cityActive: true, subscriptionStatus: "ACTIVE", planActive: true, periodStart: new Date("2026-10-01T00:00:00Z"), periodEnd: new Date("2026-11-01T00:00:00Z"), complimentary: null };

test("Basic and Pro can bulk import; pending, suspended, expired and out-of-period access cannot", () => {
  for (const state of [active, { ...active, planSlug: "basic" }, { ...active, planSlug: "professional" }]) {
    const resolved = resolveStoreEntitlements({ ...active, planSlug: "basic", ...state });
    assert.equal(hasFeature(resolved, "BULK_IMPORT"), true);
    assert.doesNotThrow(() => assertFeature(resolved, "BULK_IMPORT"));
  }
  for (const denied of [
    { ...active, planSlug: "basic", subscriptionStatus: "PENDING" },
    { ...active, planSlug: "professional", subscriptionStatus: "SUSPENDED" },
    { ...active, planSlug: "basic", subscriptionStatus: "EXPIRED" },
    { ...active, planSlug: "basic", periodEnd: new Date("2026-10-19T00:00:00Z") },
    { ...active, planSlug: "basic", periodStart: new Date("2026-10-21T00:00:00Z") },
  ]) assert.equal(hasFeature(resolveStoreEntitlements(denied, new Date("2026-10-20T12:00:00Z")), "BULK_IMPORT"), false);
});

test("admin subscription controls are role protected, store scoped, manual-only and audited", () => {
  const api = source("app/api/admin/[...resource]/route.ts");
  // The manual save transaction lives in lib/admin-manual-subscription.ts; the route only validates and delegates.
  const save = source("lib/admin-manual-subscription.ts");
  const schema = source("prisma/schema.prisma");
  const adminPage = source("app/admin/[...section]/page.tsx");
  assert.match(api, /export async function PATCH[\s\S]*?requireRole\("ADMIN"\)/);
  assert.match(api, /adminSubscriptionSchema[\s\S]*?storeId:[\s\S]*?planId:[\s\S]*?currentPeriodStart:[\s\S]*?currentPeriodEnd:[\s\S]*?reason:/);
  assert.match(api, /saveManualSubscription\(tx, \{[\s\S]*?storeId: parsed\.data\.storeId[\s\S]*?adminId: admin\.id/);
  assert.match(save, /SELECT "id" FROM "Store" WHERE "id" = \$\{input\.storeId\} FOR UPDATE/);
  assert.match(save, /accessSource: "ADMIN_MANUAL"/);
  assert.match(save, /ADMIN_SUBSCRIPTION_MANUAL_CREATE/);
  assert.match(save, /ADMIN_SUBSCRIPTION_MANUAL_UPDATE/);
  assert.match(save, /actorId: input\.adminId/);
  assert.match(api, /actorId: admin\.id/);
  assert.match(save, /grantReason: input\.reason/);
  assert.doesNotMatch(api, /payment\.create\(/);
  assert.doesNotMatch(save, /payment\.create\(/);
  assert.match(schema, /enum SubscriptionAccessSource[\s\S]*ADMIN_MANUAL[\s\S]*PAYMENT_CONFIRMED/);
  assert.match(adminPage, /db\.store\.findMany\(\{where,select:\{[\s\S]*subscription:\{select:\{[\s\S]*plan:\{select:\{name:true,monthlyPrice:true\}\},grantedByAdmin:\{select:\{email:true\}\}/);
  assert.match(adminPage, /<AdminSubscriptionManager storeId=\{store\.id\}/);
});

test("public eligibility and store entitlements deny expired or not-yet-started subscription periods", () => {
  const policy = source("lib/seller-legal-policy.ts");
  const entitlements = source("lib/subscription-entitlements.ts");
  assert.match(policy, /currentPeriodStart: \{ lte: now \}/);
  assert.match(policy, /currentPeriodEnd: \{ gt: now \}/);
  assert.match(entitlements, /state\.periodStart <= now/);
  assert.match(entitlements, /state\.periodEnd > now/);
});

test("vendor import remains authenticated and writes only within the authorized store", () => {
  const route = source("app/api/vendor/[storeId]/[section]/route.ts");
  assert.match(route, /async function scope\(storeId:string\)\{const access=await requireStoreAccess\(storeId\)/);
  assert.match(route, /updateMany\(\{where:\{id:row\.existingId,storeId\}/);
  assert.match(route, /data:\{storeId,sourceName,status:"VALIDATING"/);
  assert.match(route, /assertFeature\(entitlement,"BULK_IMPORT"\)/);
});
