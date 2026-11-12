import assert from "node:assert/strict";
import test from "node:test";
import type { DraftProductCandidate, StorePublicationState } from "../lib/admin-store-product-publishing";
import { checkVendorProductActivation, isVendorProductActivation } from "../lib/vendor-product-publication";

const eligibleStore: StorePublicationState = {
  status: "ACTIVE",
  isActive: true,
  legalInfoApproved: true,
  adminManaged: false,
  vendorActive: true,
  cityActive: true,
  sellerType: "INDIVIDUAL_ENTREPRENEUR",
  legalName: "Synthetic Seller",
  voen: "1234567890",
  legalAddress: null,
  subscriptionStatus: "ACTIVE",
  planSlug: "basic",
  planActive: true,
  periodStart: null,
  periodEnd: null,
  complimentary: null,
};

const readyProduct: DraftProductCandidate = {
  id: "synthetic-product",
  name: "Synthetic Product",
  description: null,
  price: 25,
  discountPrice: null,
  categoryId: "synthetic-category",
  category: { isActive: true },
  inventory: [{ variantId: null, quantity: 5, reserved: 0 }],
  variants: [],
};

const check = (
  store: StorePublicationState,
  product: DraftProductCandidate = readyProduct,
  activeProductCount = 0,
) => checkVendorProductActivation({ store, product, activeProductCount, now: new Date("2026-10-23T00:00:00.000Z") });

test("eligible store and valid product pass the actual vendor activation policy", () => {
  assert.deepEqual(check(eligibleStore), { ok: true, plan: "BASIC" });
});

test("store approval, legal completeness, lifecycle, vendor, and city blockers reject activation", () => {
  for (const store of [
    { ...eligibleStore, legalInfoApproved: false },
    { ...eligibleStore, legalName: " " },
    { ...eligibleStore, sellerType: "REGISTERED_COMPANY", legalAddress: null },
    { ...eligibleStore, status: "SUSPENDED" },
    { ...eligibleStore, isActive: false },
    { ...eligibleStore, vendorActive: false },
    { ...eligibleStore, cityActive: false },
  ]) {
    const result = check(store);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "STORE_NOT_ELIGIBLE");
  }
});

test("pending, expired, inactive, and unsupported subscriptions reject non-managed stores", () => {
  for (const store of [
    { ...eligibleStore, subscriptionStatus: "PENDING" },
    { ...eligibleStore, subscriptionStatus: "EXPIRED" },
    { ...eligibleStore, planActive: false },
    { ...eligibleStore, planSlug: "unsupported" },
    { ...eligibleStore, periodEnd: new Date("2026-10-22T23:59:59.000Z") },
  ]) {
    const result = check(store);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "STORE_NOT_ELIGIBLE");
  }
});

test("admin-managed stores retain BASIC entitlement rules but still require approved, active readiness", () => {
  const managed: StorePublicationState = {
    ...eligibleStore,
    adminManaged: true,
    subscriptionStatus: null,
    planSlug: null,
    planActive: false,
  };
  assert.deepEqual(check(managed), { ok: true, plan: "BASIC" });
  assert.equal(check({ ...managed, legalInfoApproved: false }).ok, false);
});

test("server legal-policy overrides are honored without bypassing separate approval", () => {
  const prior = process.env.BAGATI_SELLER_LEGAL_POLICY;
  process.env.BAGATI_SELLER_LEGAL_POLICY = JSON.stringify({
    INDIVIDUAL_ENTREPRENEUR: ["legalName"],
    REGISTERED_COMPANY: ["legalName"],
  });
  try {
    assert.deepEqual(check({ ...eligibleStore, voen: null }), { ok: true, plan: "BASIC" });
    assert.equal(check({ ...eligibleStore, voen: null, legalInfoApproved: false }).ok, false);
  } finally {
    if (prior === undefined) delete process.env.BAGATI_SELLER_LEGAL_POLICY;
    else process.env.BAGATI_SELLER_LEGAL_POLICY = prior;
  }
});

test("product category, price, variants, and inventory blockers reject activation", () => {
  for (const product of [
    { ...readyProduct, category: null },
    { ...readyProduct, categoryId: null },
    { ...readyProduct, price: 0 },
    { ...readyProduct, discountPrice: 25 },
    { ...readyProduct, inventory: [] },
    { ...readyProduct, inventory: [{ variantId: null, quantity: 2, reserved: 3 }] },
    {
      ...readyProduct,
      inventory: [],
      variants: [{
        id: "synthetic-variant",
        name: "Size",
        options: {},
        isActive: true,
        price: null,
        discountPrice: null,
        inventory: [{ variantId: "synthetic-variant", quantity: 2, reserved: 0 }],
      }],
    },
    {
      ...readyProduct,
      inventory: [],
      variants: [{
        id: "synthetic-variant",
        name: "Size",
        options: { size: "M" },
        isActive: true,
        price: null,
        discountPrice: null,
        inventory: [],
      }],
    },
  ]) {
    const result = check(eligibleStore, product);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "PRODUCT_NOT_READY");
  }
});

test("product activation enforces active-product limits, including the BASIC admin-managed limit", () => {
  const paidAtLimit = check(eligibleStore, readyProduct, 300);
  assert.deepEqual(paidAtLimit, { ok: false, reason: "PRODUCT_LIMIT_REACHED", plan: "BASIC", current: 300, limit: 300 });

  const managedAtLimit = check({
    ...eligibleStore,
    adminManaged: true,
    subscriptionStatus: null,
    planSlug: null,
    planActive: false,
  }, readyProduct, 300);
  assert.deepEqual(managedAtLimit, { ok: false, reason: "PRODUCT_LIMIT_REACHED", plan: "BASIC", current: 300, limit: 300 });
});

test("only a transition to ACTIVE triggers activation-only checks", () => {
  assert.equal(isVendorProductActivation("DRAFT", "ACTIVE"), true);
  assert.equal(isVendorProductActivation("ARCHIVED", "ACTIVE"), true);
  assert.equal(isVendorProductActivation("ACTIVE", "ACTIVE"), false);
  assert.equal(isVendorProductActivation("DRAFT", "DRAFT"), false);
  assert.equal(isVendorProductActivation("DRAFT", undefined), false);
});
