import assert from "node:assert/strict";
import test from "node:test";
import { buildAdminStoreReadiness } from "../lib/admin-store-readiness.ts";

const dependencies = {
  missingSellerLegalFields(profile) {
    const required = profile.sellerType === "REGISTERED_COMPANY"
      ? ["legalName", "voen", "legalAddress"]
      : ["legalName", "voen"];
    return required.filter((field) => !profile[field]?.trim());
  },
  resolveStoreEntitlements(state) {
    const subscription = state.subscriptionStatus === "ACTIVE" && state.planActive;
    return { eligible: state.storeActive && state.storeStatus === "ACTIVE" && state.vendorActive && state.cityActive && (state.adminManaged || subscription) };
  },
};

const base = {
  name: "Mağaza", slug: "magaza", description: "Təsvir", logoUrl: "/logo.webp", bannerUrl: "/banner.webp",
  contactPhone: "+994", contactEmail: "store@example.test", address: "Bakı", cityName: "Bakı", cityActive: true,
  vendorActive: true, sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: "Satıcı", voen: "123", legalAddress: null,
  legalInfoApproved: true, adminManaged: false, storeStatus: "ACTIVE", storeActive: true,
  subscription: { status: "ACTIVE", periodStart: null, periodEnd: null, planSlug: "basic", planActive: true },
  productCount: 1, activeProductCount: 1, categoryLinkedProductCount: 1,
};

test("store readiness reports a pending, legally incomplete setup as blocked", () => {
  const items = buildAdminStoreReadiness({ ...base, storeStatus: "PENDING_REVIEW", legalInfoApproved: false, voen: null, subscription: null }, dependencies);
  assert.equal(items.find((item) => item.label === "Satıcı hüquqi məlumatları").ready, false);
  assert.equal(items.find((item) => item.label === "Satış hüququ və abunəlik").ready, false);
  assert.equal(items.find((item) => item.label === "Mağaza statusu").ready, false);
});

test("store readiness uses subscription eligibility and keeps operational checks distinct", () => {
  const items = buildAdminStoreReadiness(base, dependencies);
  assert.equal(items.every((item) => item.ready), true);
  const inactivePlan = buildAdminStoreReadiness({ ...base, subscription: { ...base.subscription, planActive: false } }, dependencies);
  assert.equal(inactivePlan.find((item) => item.label === "Satış hüququ və abunəlik").ready, false);
  assert.equal(inactivePlan.find((item) => item.label === "Satıcı hüquqi məlumatları").ready, true);
});
