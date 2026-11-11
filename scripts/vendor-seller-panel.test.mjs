import test from "node:test";
import assert from "node:assert/strict";
import { buildVendorStoreSetup } from "../lib/vendor-store-setup.ts";
import { summarizeVendorFinance, vendorFinanceCsv, weekKey } from "../lib/vendor-finance.ts";
import { stockAlertCrossing, stockAlertNotification, vendorNotificationHref, VENDOR_NOTIFICATION_TITLES } from "../lib/vendor-notifications.ts";

const baseStore = {
  name: "Gül Butik", slug: "gul-butik", description: "Qadın geyimləri", cityName: "Bakı",
  contactPhone: "+994501112233", contactEmail: "info@example.az", address: "Nizami küç. 1",
  logoUrl: "/uploads/logo.webp", bannerUrl: "/uploads/banner.webp", bannerSupported: true,
  missingLegalFields: [], legalInfoApproved: true, adminManaged: false,
  storeStatus: "ACTIVE", storeActive: true, reviewNote: null, subscriptionStatus: "ACTIVE",
  productCount: 3, activeProductCount: 2,
};

test("a fully prepared, approved store completes every setup step", () => {
  const setup = buildVendorStoreSetup(baseStore);
  assert.equal(setup.completed, setup.total);
  assert.equal(setup.percent, 100);
  assert.equal(setup.nextStep, null);
  assert.equal(setup.approval.tone, "success");
});

test("a new draft store lists exactly what is missing and points to the first gap", () => {
  const setup = buildVendorStoreSetup({
    ...baseStore, description: "", contactPhone: null, contactEmail: "", address: null, logoUrl: null, bannerUrl: null,
    missingLegalFields: ["VÖEN"], legalInfoApproved: false, storeStatus: "DRAFT", storeActive: false, productCount: 0, activeProductCount: 0,
  });
  assert.equal(setup.completed, 0);
  assert.equal(setup.nextStep?.key, "info");
  assert.match(setup.steps.find((s) => s.key === "info").detail, /mağaza təsviri/);
  assert.match(setup.steps.find((s) => s.key === "contact").detail, /telefon, e-poçt, ünvan/);
  assert.match(setup.steps.find((s) => s.key === "legal").detail, /VÖEN/);
  assert.equal(setup.steps.find((s) => s.key === "products").href, "products/new");
  assert.equal(setup.approval.label, "Qaralama");
});

test("a draft is never reported as approved, and a pending review stays pending", () => {
  assert.equal(buildVendorStoreSetup({ ...baseStore, storeStatus: "DRAFT", storeActive: false }).steps.at(-1).done, false);
  const pending = buildVendorStoreSetup({ ...baseStore, storeStatus: "PENDING_REVIEW", storeActive: false, legalInfoApproved: false });
  assert.equal(pending.steps.at(-1).done, false);
  assert.equal(pending.approval.label, "Gözləmədə");
});

test("rejection shows the administrator's reason", () => {
  const setup = buildVendorStoreSetup({ ...baseStore, storeStatus: "REJECTED", storeActive: false, reviewNote: "VÖEN uyğun deyil" });
  assert.equal(setup.approval.tone, "danger");
  assert.match(setup.approval.detail, /VÖEN uyğun deyil/);
});

test("banner is not required when the database cannot store it", () => {
  const setup = buildVendorStoreSetup({ ...baseStore, bannerUrl: null, bannerSupported: false });
  assert.equal(setup.steps.find((s) => s.key === "branding").done, true);
});

const order = (overrides) => ({
  id: overrides.id, status: "DELIVERED", subtotal: "100.00", deliveryFee: "5.00", commissionRateSnapshot: "0.1000",
  createdAt: new Date(2026, 10, 2, 10), deliveredAt: new Date(2026, 10, 3, 12), paymentStatuses: ["PAID"],
  itemQuantity: 2, returnRequests: [], ...overrides,
});

test("only delivered orders count as sales; commission uses the order's own rate snapshot", () => {
  const summary = summarizeVendorFinance([
    order({ id: "a" }),
    order({ id: "b", commissionRateSnapshot: "0.0500", subtotal: "40.00", itemQuantity: 1 }),
    order({ id: "c", status: "CANCELLED" }),
  ]);
  assert.equal(summary.deliveredOrders, 2);
  assert.equal(summary.netSalesCents, 14000);
  assert.equal(summary.commissionCents, 1000 + 200);
  assert.equal(summary.estimatedEarningsCents, 14000 - 1200);
  assert.equal(summary.soldQuantity, 3);
});

test("refunded returns reduce net sales; requested returns do not", () => {
  const summary = summarizeVendorFinance([
    order({ id: "a", returnRequests: [{ status: "REFUNDED", refundAmount: "30.00" }, { status: "REQUESTED", refundAmount: "50.00" }] }),
  ]);
  assert.equal(summary.grossSalesCents, 10000);
  assert.equal(summary.refundedCents, 3000);
  assert.equal(summary.netSalesCents, 7000);
  assert.equal(summary.commissionCents, 700);
});

test("orders without a commission rate are reported, never guessed", () => {
  const summary = summarizeVendorFinance([order({ id: "a", commissionRateSnapshot: null })]);
  assert.equal(summary.commissionCents, 0);
  assert.equal(summary.ordersWithoutCommissionRule, 1);
  assert.equal(summary.salesWithoutCommissionRuleCents, 10000);
});

test("open orders are split by real payment state and never counted as sales", () => {
  const summary = summarizeVendorFinance([
    order({ id: "a", status: "NEW", paymentStatuses: ["PENDING"] }),
    order({ id: "b", status: "PREPARING", paymentStatuses: ["PAID"] }),
    order({ id: "c", status: "CONFIRMED", paymentStatuses: ["AUTHORIZED"] }),
  ]);
  assert.equal(summary.deliveredOrders, 0);
  assert.equal(summary.netSalesCents, 0);
  assert.deepEqual(summary.awaitingPayment, { orders: 2, amountCents: 21000 });
  assert.deepEqual(summary.paidInProgress, { orders: 1, amountCents: 10500 });
});

test("duplicate rows are counted once and buckets group by delivery date", () => {
  const summary = summarizeVendorFinance([order({ id: "a" }), order({ id: "a" }), order({ id: "b", deliveredAt: new Date(2026, 10, 9, 9) })]);
  assert.equal(summary.deliveredOrders, 2);
  assert.deepEqual(summary.daily.map((b) => b.key), ["2026-11-03", "2026-11-09"]);
  assert.deepEqual(summary.weekly.map((b) => b.key), ["2026-11-02", "2026-11-09"]);
  assert.deepEqual(summary.monthly.map((b) => [b.key, b.orders]), [["2026-11", 2]]);
});

test("weeks start on Monday", () => {
  assert.equal(weekKey(new Date(2026, 10, 15)), "2026-11-09");
  assert.equal(weekKey(new Date(2026, 10, 9)), "2026-11-09");
});

test("finance CSV is quoted, has an Azerbaijani header and neutralises formulas", () => {
  const csv = vendorFinanceCsv([{ key: "=HYPERLINK()", orders: 1, quantity: 2, netSalesCents: 1050, commissionCents: 105, estimatedEarningsCents: 945 }], "Gün");
  assert.ok(csv.startsWith("﻿"));
  assert.match(csv, /"Xalis satış \(AZN\)"/);
  assert.match(csv, /"'=HYPERLINK\(\)"/);
  assert.match(csv, /"10\.50","1\.05","9\.45"/);
});

test("stock alerts fire only when a row crosses into a worse level", () => {
  assert.equal(stockAlertCrossing(10, 5, 5), "LOW");
  assert.equal(stockAlertCrossing(5, 4, 5), null, "already low: no duplicate alert");
  assert.equal(stockAlertCrossing(4, 0, 5), "OUT");
  assert.equal(stockAlertCrossing(0, 0, 5), null);
  assert.equal(stockAlertCrossing(10, 0, 5), "OUT");
  assert.equal(stockAlertCrossing(10, 9, 5), null);
  assert.equal(stockAlertNotification("OUT", "Köynək", 0).title, VENDOR_NOTIFICATION_TITLES.outOfStock);
  assert.match(stockAlertNotification("LOW", "Köynək", 2).body, /2 ədəd/);
});

test("notification links route known seller events and ignore unknown or account-wide ones", () => {
  assert.equal(vendorNotificationHref("s1", VENDOR_NOTIFICATION_TITLES.newOrder, true), "/vendor/s1/orders");
  assert.equal(vendorNotificationHref("s1", "Yeni qaytarılma sorğusu", true), "/vendor/s1/returns");
  assert.equal(vendorNotificationHref("s1", VENDOR_NOTIFICATION_TITLES.lowStock, true), "/vendor/s1/inventory");
  assert.equal(vendorNotificationHref("s1", "Başqa bildiriş", true), null);
  assert.equal(vendorNotificationHref("s1", VENDOR_NOTIFICATION_TITLES.newOrder, false), null);
});

test("store review decisions produce one clear seller notification with the reason", async () => {
  const { storeReviewNotification } = await import("../lib/vendor-notifications.ts");
  const rejected = storeReviewNotification("STORE_REJECT", "Gül Butik", "VÖEN uyğun deyil", false);
  assert.equal(rejected.title, VENDOR_NOTIFICATION_TITLES.storeRejected);
  assert.match(rejected.body, /Səbəb: VÖEN uyğun deyil/);
  assert.match(storeReviewNotification("STORE_APPROVE", "Gül Butik", null, false).body, /satış hələ açılmayıb/);
  assert.match(storeReviewNotification("STORE_APPROVE", "Gül Butik", null, true).body, /alıcılar üçün açıqdır/);
  assert.equal(storeReviewNotification("UNKNOWN", "Gül Butik", null, true), null);
  assert.equal(vendorNotificationHref("s1", VENDOR_NOTIFICATION_TITLES.storeApproved, true), "/vendor/s1");
  assert.equal(vendorNotificationHref("s1", VENDOR_NOTIFICATION_TITLES.storeRejected, true), "/vendor/s1/profile");
});
