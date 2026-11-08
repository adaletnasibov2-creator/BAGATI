import test from "node:test";
import assert from "node:assert/strict";
import { calculateCampaignPrice, calculateEffectivePrice, hasOverlappingEnabledPromotion, productPromotions, promotionStatus } from "../lib/promotion-pricing";

const now = new Date("2026-10-06T12:00:00.000Z");
const campaign = (overrides: Partial<Parameters<typeof promotionStatus>[0]> = {}) => ({
  id: "campaign-1", name: "Payız endirimi", startsAt: new Date("2026-10-01T00:00:00.000Z"),
  endsAt: new Date("2026-10-31T23:59:59.000Z"), isActive: true, discountType: "PERCENT", discountValue: 20, ...overrides,
});

test("calculates percentage and fixed campaign prices without floating point drift", () => {
  assert.equal(calculateCampaignPrice("100.00", "PERCENT", 20)?.toFixed(2), "80.00");
  assert.equal(calculateCampaignPrice("100.00", "FIXED", 15)?.toFixed(2), "85.00");
});

test("rejects discounts that produce zero, negative, or unchanged prices", () => {
  assert.equal(calculateCampaignPrice(100, "PERCENT", 100), null);
  assert.equal(calculateCampaignPrice(100, "PERCENT", 150), null);
  assert.equal(calculateCampaignPrice(100, "FIXED", 100), null);
  assert.equal(calculateCampaignPrice(100, "FIXED", 101), null);
});

test("campaign lifecycle respects disabled, future, active, and expired states", () => {
  assert.equal(promotionStatus(campaign({ isActive: false }), now), "DISABLED");
  assert.equal(promotionStatus(campaign({ startsAt: new Date("2026-10-07T00:00:00.000Z") }), now), "SCHEDULED");
  assert.equal(promotionStatus(campaign(), now), "ACTIVE");
  assert.equal(promotionStatus(campaign({ endsAt: new Date("2026-10-05T00:00:00.000Z") }), now), "EXPIRED");
});

test("one effective promotion wins deterministically and does not stack with manual discounts", () => {
  const later = campaign({ id: "b", startsAt: new Date("2026-10-03T00:00:00.000Z"), discountValue: 50 });
  const earlier = campaign({ id: "a", startsAt: new Date("2026-10-02T00:00:00.000Z"), discountValue: 10 });
  const result = calculateEffectivePrice(100, 70, [later, earlier], now);
  assert.equal(result.unitPrice.toFixed(2), "90.00");
  assert.equal(result.promotion?.id, "a");
});

test("expired promotions are ignored and the valid manual price remains effective", () => {
  const expired = campaign({ endsAt: new Date("2026-10-05T00:00:00.000Z"), discountValue: 50 });
  const result = calculateEffectivePrice(100, 80, [expired], now);
  assert.equal(result.unitPrice.toFixed(2), "80.00");
  assert.equal(result.promotion, null);
});

test("promotion links are accepted only for the product's own store", () => {
  const own = { ...campaign(), storeId: "store-a" };
  const foreign = { ...campaign({ id: "foreign" }), storeId: "store-b" };
  assert.deepEqual(productPromotions([{ promotion: own }, { promotion: foreign }], "store-a"), [own]);
});

test("detects intersecting product campaign windows", () => {
  const startsAt = new Date("2026-10-05T00:00:00.000Z"), endsAt = new Date("2026-10-10T00:00:00.000Z");
  assert.equal(hasOverlappingEnabledPromotion(startsAt, endsAt, [{ startsAt: new Date("2026-10-01T00:00:00.000Z"), endsAt: new Date("2026-10-06T00:00:00.000Z") }]), true);
  assert.equal(hasOverlappingEnabledPromotion(startsAt, endsAt, [{ startsAt: new Date("2026-10-10T00:00:00.000Z"), endsAt: new Date("2026-10-12T00:00:00.000Z") }]), false);
});
