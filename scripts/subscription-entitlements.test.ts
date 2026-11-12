import test from "node:test";
import assert from "node:assert/strict";
import { assertFeature, exceedsEntitlementLimit, exceedsVariantLimit, hasFeature, isProBadgeEligible, planEntitlements, resolveStoreEntitlements } from "../lib/subscription-entitlements";

const activeBasic = {
  adminManaged: false,
  storeStatus: "ACTIVE", storeActive: true, vendorActive: true, cityActive: true,
  subscriptionStatus: "ACTIVE", planSlug: "basic", planActive: true, periodEnd: null,
  complimentary: null,
};
const activePro = { ...activeBasic, planSlug: "professional" };

test("BASIC and PRO plans resolve only for eligible stores with active subscriptions", () => {
  assert.equal(resolveStoreEntitlements(activeBasic).plan, "BASIC");
  assert.equal(resolveStoreEntitlements(activePro).plan, "PRO");
  for (const status of ["PENDING", "PAST_DUE", "SUSPENDED", "CANCELLED", "EXPIRED"]) {
    assert.equal(resolveStoreEntitlements({ ...activePro, subscriptionStatus: status }).eligible, false, status);
  }
  assert.equal(resolveStoreEntitlements({ ...activePro, periodEnd: new Date(Date.now() - 1000) }).eligible, false);
  assert.equal(resolveStoreEntitlements({ ...activePro, storeStatus: "SUSPENDED" }).eligible, false);
  assert.equal(resolveStoreEntitlements({ ...activePro, vendorActive: false }).eligible, false);
  assert.equal(resolveStoreEntitlements({ ...activePro, planActive: false }).eligible, false);
  assert.equal(resolveStoreEntitlements({ ...activeBasic, planSlug: "unsupported" }).eligible, false);
});

test("admin-managed stores use BASIC limits without a subscription, but still require active store, vendor, and city", () => {
  const managed = resolveStoreEntitlements({
    ...activeBasic,
    adminManaged: true,
    subscriptionStatus: null,
    planSlug: null,
    planActive: false,
  });
  assert.deepEqual(managed, { eligible: true, plan: "BASIC", limits: planEntitlements.BASIC });
  assert.equal(resolveStoreEntitlements({ ...activeBasic, adminManaged: true, storeStatus: "SUSPENDED" }).eligible, false);
  assert.equal(resolveStoreEntitlements({ ...activeBasic, adminManaged: true, vendorActive: false }).eligible, false);
  assert.equal(resolveStoreEntitlements({ ...activeBasic, adminManaged: true, cityActive: false }).eligible, false);
});

test("server entitlement limits count only active products and project active variants store-wide", () => {
  assert.equal(exceedsEntitlementLimit(299, 1, planEntitlements.BASIC.activeProducts), false);
  assert.equal(exceedsEntitlementLimit(300, 1, planEntitlements.BASIC.activeProducts), true);
  assert.equal(exceedsEntitlementLimit(1999, 1, planEntitlements.PRO.activeProducts), false);
  assert.equal(exceedsEntitlementLimit(2000, 1, planEntitlements.PRO.activeProducts), true);
  assert.equal(exceedsVariantLimit(999, 0, 1, planEntitlements.BASIC.activeVariants), false);
  assert.equal(exceedsVariantLimit(1000, 0, 1, planEntitlements.BASIC.activeVariants), true);
  assert.equal(exceedsVariantLimit(9999, 0, 1, planEntitlements.PRO.activeVariants), false);
  assert.equal(exceedsVariantLimit(10000, 0, 1, planEntitlements.PRO.activeVariants), true);
  assert.equal(exceedsVariantLimit(25, 10, 12, 1000), false, "existing variants on the edited product are replaced, not double-counted");
});

test("bulk import is available to active BASIC and PRO subscriptions only", () => {
  const basic = resolveStoreEntitlements(activeBasic);
  const pro = resolveStoreEntitlements(activePro);
  assert.equal(hasFeature(basic, "BULK_IMPORT"), true);
  assert.equal(hasFeature(pro, "BULK_IMPORT"), true);
  assert.doesNotThrow(() => assertFeature(basic, "BULK_IMPORT"));
  assert.doesNotThrow(() => assertFeature(pro, "BULK_IMPORT"));
  assert.throws(() => assertFeature(resolveStoreEntitlements({ ...activePro, subscriptionStatus: "EXPIRED" }), "BULK_IMPORT"), /SUBSCRIPTION_REQUIRED/);
  assert.equal(hasFeature(resolveStoreEntitlements({ ...activePro, subscriptionStatus: "PENDING" }), "BULK_IMPORT"), false);
  assert.equal(hasFeature(resolveStoreEntitlements({ ...activeBasic, subscriptionStatus: "SUSPENDED" }), "BULK_IMPORT"), false);
  assert.equal(hasFeature(resolveStoreEntitlements({ ...activeBasic, periodEnd: new Date(Date.now() - 1) }), "BULK_IMPORT"), false);
});

test("future PRO capabilities have typed entitlement identifiers but do not claim integrations exist", () => {
  assert.doesNotThrow(() => assertFeature(resolveStoreEntitlements(activePro), "API_ACCESS"));
  assert.doesNotThrow(() => assertFeature(resolveStoreEntitlements(activePro), "POS_INTEGRATION"));
  assert.doesNotThrow(() => assertFeature(resolveStoreEntitlements(activePro), "ERP_INTEGRATION"));
  assert.throws(() => assertFeature(resolveStoreEntitlements(activeBasic), "REPORT_EXPORT"), /REPORT_EXPORT_PRO_ONLY/);
});

test("PRO badge eligibility follows only an active, eligible, unexpired PRO subscription", () => {
  assert.equal(isProBadgeEligible(activePro), true);
  assert.equal(isProBadgeEligible({ ...activePro, subscriptionStatus: "EXPIRED" }), false);
  assert.equal(isProBadgeEligible({ ...activePro, periodEnd: new Date(Date.now() - 1) }), false);
  assert.equal(isProBadgeEligible({ ...activePro, storeStatus: "SUSPENDED" }), false);
});
