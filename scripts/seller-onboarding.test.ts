import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { missingSellerLegalFields, publicStoreWhere, sellerLegalRequirements } from "../lib/seller-legal-policy";
import { getStoreReviewUpdate } from "../lib/store-review";
import { checkStoreSubmission } from "../lib/store-submission";
import { vendorRegisterSchema } from "../lib/validation";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

test("pending store can be approved only when seller legal information is complete", () => {
  const incomplete = getStoreReviewUpdate("approve", "PENDING_REVIEW", false);
  assert.deepEqual(incomplete, { ok: false, error: "LEGAL_INFORMATION_INCOMPLETE" });
  const complete = getStoreReviewUpdate("approve", "PENDING_REVIEW", true);
  assert.equal(complete.ok, true);
  if (complete.ok) {
    assert.equal(complete.update.status, "ACTIVE");
    assert.equal(complete.update.legalInfoApproved, true);
  }
});

test("rejected and suspended stores cannot be published or reactivated without review", () => {
  assert.deepEqual(getStoreReviewUpdate("approve", "REJECTED", true), { ok: false, error: "INVALID_STATUS" });
  assert.deepEqual(getStoreReviewUpdate("reactivate", "SUSPENDED", false), { ok: false, error: "LEGAL_INFORMATION_INCOMPLETE" });
  const reactivated = getStoreReviewUpdate("reactivate", "SUSPENDED", true);
  assert.equal(reactivated.ok, true);
  if (reactivated.ok) assert.equal(reactivated.update.legalInfoApproved, true);
});

test("rejection and suspension require reasons and revoke legal approval", () => {
  assert.deepEqual(getStoreReviewUpdate("reject", "PENDING_REVIEW", true), { ok: false, error: "REASON_REQUIRED" });
  assert.deepEqual(getStoreReviewUpdate("suspend", "ACTIVE", true), { ok: false, error: "REASON_REQUIRED" });
  const rejected = getStoreReviewUpdate("reject", "PENDING_REVIEW", true, "Sənədlər natamamdır");
  assert.equal(rejected.ok, true);
  if (rejected.ok) assert.equal(rejected.update.legalInfoApproved, false);
  const suspended = getStoreReviewUpdate("suspend", "ACTIVE", true, "Yoxlama tələb olunur");
  assert.equal(suspended.ok, true);
  if (suspended.ok) assert.equal(suspended.update.legalInfoApproved, false);
});

test("seller type and policy-required legal fields are required", () => {
  assert.deepEqual(missingSellerLegalFields({ sellerType: null, legalName: null, voen: null, legalAddress: null }), ["sellerType", "legalName", "voen"]);
  for (const invalidValue of [null, "", " \t\n"]) {
    assert.deepEqual(missingSellerLegalFields({
      sellerType: "INDIVIDUAL_ENTREPRENEUR",
      legalName: invalidValue,
      voen: "123",
      legalAddress: null,
    }), ["legalName"]);
    assert.deepEqual(missingSellerLegalFields({
      sellerType: "REGISTERED_COMPANY",
      legalName: "Company",
      voen: "123",
      legalAddress: invalidValue,
    }), ["legalAddress"]);
  }
  assert.deepEqual(missingSellerLegalFields({
    sellerType: "REGISTERED_COMPANY",
    legalName: "Company",
    voen: "123",
    legalAddress: "Baku, 1 Street",
  }), []);
});

test("store review submission requires complete legal information and a valid status", () => {
  const complete = {
    status: "DRAFT",
    legalInfoApproved: false,
    adminManaged: false,
    hasSubscription: true,
    sellerType: "INDIVIDUAL_ENTREPRENEUR",
    legalName: "Seller name",
    voen: "1234567890",
    legalAddress: null,
  };
  assert.deepEqual(checkStoreSubmission(complete), { ok: true });
  assert.deepEqual(checkStoreSubmission({ ...complete, legalName: "  " }), {
    ok: false,
    reason: "LEGAL_INFORMATION_INCOMPLETE",
    missingFields: ["legalName"],
  });
  assert.deepEqual(checkStoreSubmission({ ...complete, status: "PENDING_REVIEW" }), {
    ok: false,
    reason: "INVALID_STATUS",
    missingFields: [],
  });
  assert.deepEqual(checkStoreSubmission({ ...complete, status: "ACTIVE", legalInfoApproved: true }), {
    ok: false,
    reason: "INVALID_STATUS",
    missingFields: [],
  });
});

test("store submission honors company requirements, admin-managed stores, and subscription gating", () => {
  const company = {
    status: "REJECTED",
    legalInfoApproved: false,
    adminManaged: false,
    hasSubscription: true,
    sellerType: "REGISTERED_COMPANY",
    legalName: "Company",
    voen: "1234567890",
    legalAddress: null,
  };
  assert.deepEqual(checkStoreSubmission(company), {
    ok: false,
    reason: "LEGAL_INFORMATION_INCOMPLETE",
    missingFields: ["legalAddress"],
  });
  assert.deepEqual(checkStoreSubmission({ ...company, adminManaged: true, hasSubscription: false, legalAddress: "Baku" }), { ok: true });
  assert.deepEqual(checkStoreSubmission({ ...company, hasSubscription: false, legalAddress: "Baku" }), {
    ok: false,
    reason: "SUBSCRIPTION_REQUIRED",
    missingFields: [],
  });
});

test("seller legal requirements can be configured independently by seller type", () => {
  const prior = process.env.BAGATI_SELLER_LEGAL_POLICY;
  process.env.BAGATI_SELLER_LEGAL_POLICY = JSON.stringify({ INDIVIDUAL_ENTREPRENEUR: ["legalName"], REGISTERED_COMPANY: ["legalName", "legalAddress"] });
  try {
    assert.deepEqual(sellerLegalRequirements("INDIVIDUAL_ENTREPRENEUR"), ["legalName"]);
    assert.deepEqual(sellerLegalRequirements("REGISTERED_COMPANY"), ["legalName", "legalAddress"]);
    assert.deepEqual(checkStoreSubmission({
      status: "DRAFT",
      legalInfoApproved: false,
      adminManaged: false,
      hasSubscription: true,
      sellerType: "INDIVIDUAL_ENTREPRENEUR",
      legalName: "Seller name",
      voen: null,
      legalAddress: null,
    }), { ok: true });
  } finally {
    if (prior === undefined) delete process.env.BAGATI_SELLER_LEGAL_POLICY;
    else process.env.BAGATI_SELLER_LEGAL_POLICY = prior;
  }
});

test("public eligibility requires active approval, legal review, and subscription", () => {
  const where = publicStoreWhere(new Date("2026-10-20T12:00:00.000Z"));
  assert.equal(where.status, "ACTIVE");
  assert.equal(where.isActive, true);
  assert.equal(where.legalInfoApproved, true);
  assert.deepEqual(where.OR, [
    { adminManaged: true },
    { subscription: { is: { status: "ACTIVE", AND: [
      { OR: [{ currentPeriodStart: null }, { currentPeriodStart: { lte: new Date("2026-10-20T12:00:00.000Z") } }] },
      { OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: new Date("2026-10-20T12:00:00.000Z") } }] },
    ], plan: { isActive: true, slug: { in: ["basic", "pro", "professional"], mode: "insensitive" } } } } },
  ]);
  assert.ok(where.vendor);
});

test("public eligibility excludes whitespace-only legal values using trim-aware application validation", () => {
  assert.deepEqual(missingSellerLegalFields({
    sellerType: "INDIVIDUAL_ENTREPRENEUR",
    legalName: "  ",
    voen: "\t",
    legalAddress: null,
  }), ["legalName", "voen"]);
});

test("direct store status changes cannot bypass review authorization", () => {
  const adminApi = source("app/api/admin/[...resource]/route.ts");
  const reviewApi = source("app/api/admin/stores/[storeId]/review/route.ts");
  assert.match(adminApi, /section === "stores"[\s\S]*?"status" in body[\s\S]*?status: 405/);
  assert.match(reviewApi, /requireRole\("ADMIN"\)/);
});

test("seller legal edits revoke eligibility without changing existing store statuses", () => {
  const vendorApi = source("app/api/vendor/[storeId]/[section]/route.ts");
  assert.match(vendorApi, /updateMany\(\{where:\{vendorId:owned\.vendorId\},data:\{legalInfoApproved:false\}\}\)/);
  assert.match(vendorApi, /storeStatusesPreserved:true/);
});

test("profile review submission saves the current form before sending it for review", () => {
  const component = source("components/vendor-store-profile-editor.tsx");
  const submitHandler = component.slice(component.indexOf("async function submitReview"));
  assert.match(component, /<form ref=\{profileForm\} onSubmit=\{save\}/);
  assert.match(submitHandler, /form\.reportValidity\(\)/);
  assert.ok(submitHandler.indexOf("await saveProfile(form)") < submitHandler.indexOf('asyncAction(`/api/vendor/${store.id}/submit`'));

  const vendorApi = source("app/api/vendor/[storeId]/[section]/route.ts");
  assert.match(vendorApi, /checkStoreSubmission\(\{/);
  assert.match(vendorApi, /missingFields:submission\.missingFields/);
  assert.match(vendorApi, /status:true,isActive:true,legalInfoApproved:true/);
});

test("customer seller application requires no tax number and preserves existing records", () => {
  const application = source("app/api/vendor/apply/route.ts");
  assert.match(application, /user\.role !== "CUSTOMER"/);
  assert.match(application, /sellerType: z\.enum/);
  assert.doesNotMatch(application, /voen:/);
  assert.match(application, /data: \{ role: "VENDOR" \}/);
  assert.doesNotMatch(application, /\.delete\(/);
});

test("vendor registration schema still requires a contact phone", () => {
  const data = { email: "seller@example.test", password: "a-long-test-password", firstName: "Aysel", lastName: "Satici" };
  assert.equal(vendorRegisterSchema.safeParse(data).success, false);
  assert.equal(vendorRegisterSchema.safeParse({ ...data, phone: "+994501234567" }).success, true);
});

test("seller self-registration is closed: sellers start as customers and apply at /vendor/apply", () => {
  const route = source("app/api/auth/vendor-register/route.ts");
  const page = source("app/vendor/register/page.tsx");
  const form = source("components/vendor-register-form.tsx");
  const login = source("components/vendor-login-form.tsx");
  assert.match(route, /status: 410/);
  assert.match(route, /SELLER_SELF_REGISTRATION_CLOSED/);
  assert.doesNotMatch(route, /prisma|\.create\(/);
  assert.match(page, /redirect\("\/register\?next=%2Fvendor%2Fapply"\)/);
  assert.doesNotMatch(form, /GoogleOAuthButton/);
  assert.match(login, /href="\/vendor\/apply"[\s\S]*?Satıcı olmaq istəyirəm/);
  assert.doesNotMatch(login, /href="\/vendor\/register"/);
});
