import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEALS_CAMPAIGN_PRODUCT_LIMIT,
  dealsCampaignHref,
  dealsCampaignParam,
  groupDealsCampaignProducts,
  type DealsCampaignProduct,
} from "../lib/deals-campaigns";

const NOW = new Date("2026-10-15T00:00:00.000Z");

type TestProduct = DealsCampaignProduct & { name: string };

function product(id: string, storeId = "store-a", overrides: Partial<TestProduct> = {}): TestProduct {
  return {
    id, name: id, storeId, price: 100, discountPrice: null, store: { id: storeId },
    inventory: [{ variantId: null, quantity: 5, reserved: 0 }], variants: [],
    ...overrides,
  };
}

function campaign(id: string, storeId: string | null, products: TestProduct[], overrides: Record<string, unknown> = {}) {
  return {
    id, storeId, name: `Kampaniya ${id}`, startsAt: new Date("2026-10-01T00:00:00.000Z"), endsAt: new Date("2026-11-01T00:00:00.000Z"),
    isActive: true, discountType: "PERCENT", discountValue: 10, products: products.map((p) => ({ product: p })),
    ...overrides,
  };
}

const ids = (list: { id: string }[]) => list.map((p) => p.id);

test("cap: at most 12 products per campaign are shown; total counts every product that passed", () => {
  assert.equal(DEALS_CAMPAIGN_PRODUCT_LIMIT, 12);
  const many = Array.from({ length: 30 }, (_, i) => product(`p${String(i).padStart(2, "0")}`));
  const few = Array.from({ length: 5 }, (_, i) => product(`q${i}`, "store-b"));
  const { groups } = groupDealsCampaignProducts([campaign("a", "store-a", many), campaign("b", "store-b", few)], NOW, DEALS_CAMPAIGN_PRODUCT_LIMIT);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].products.length, 12);
  assert.equal(groups[0].total, 30);
  assert.equal(groups[1].products.length, 5);
  assert.equal(groups[1].total, 5);
});

test("cap: null shows every product (the ?campaign= view)", () => {
  const many = Array.from({ length: 30 }, (_, i) => product(`p${i}`));
  const { groups } = groupDealsCampaignProducts([campaign("a", "store-a", many)], NOW, null);
  assert.equal(groups[0].products.length, 30);
  assert.equal(groups[0].total, 30);
});

test("order: campaigns keep the given order and products keep the campaign's product order; the cap takes the first 12", () => {
  const list = Array.from({ length: 15 }, (_, i) => product(`p${14 - i}`));
  const { groups } = groupDealsCampaignProducts(
    [campaign("second-by-id", "store-b", [product("x", "store-b")]), campaign("first-by-id", "store-a", list)],
    NOW,
    DEALS_CAMPAIGN_PRODUCT_LIMIT,
  );
  assert.deepEqual(groups.map((g) => g.campaign.id), ["second-by-id", "first-by-id"]);
  assert.deepEqual(ids(groups[1].products), ids(list.slice(0, 12)));
});

test("eligibility: own store only, sellable stock only, a real campaign price only, first campaign wins", () => {
  const items = [
    product("wrong-store", "store-b"),
    product("sold-out", "store-a", { inventory: [{ variantId: null, quantity: 2, reserved: 2 }] }),
    product("variant-stock", "store-a", { inventory: [{ variantId: null, quantity: 0, reserved: 0 }], variants: [{ inventory: [{ quantity: 3, reserved: 1 }] }] }),
    product("variant-sold-out", "store-a", { inventory: [{ variantId: null, quantity: 9, reserved: 0 }], variants: [{ inventory: [{ quantity: 1, reserved: 1 }] }] }),
    product("too-cheap", "store-a", { price: 0 }),
    product("ok"),
    product("shared"),
  ];
  const first = campaign("a", "store-a", items);
  const second = campaign("c", "store-a", [product("shared"), product("only-second")]);
  const { groups, promotedIds } = groupDealsCampaignProducts([first, second], NOW, DEALS_CAMPAIGN_PRODUCT_LIMIT);
  assert.deepEqual(ids(groups[0].products), ["variant-stock", "ok", "shared"]);
  assert.deepEqual(ids(groups[1].products), ["only-second"]);
  assert.equal(groups[0].products[1].effectivePrice, "90.00");
  assert.equal(groups[0].products[1].campaignName, "Kampaniya a");
  assert.deepEqual([...promotedIds].sort(), ["ok", "only-second", "shared", "variant-stock"]);
});

test("eligibility: a campaign that is ended, disabled or without a usable discount yields no group", () => {
  const p = [product("p1")];
  const result = groupDealsCampaignProducts([
    campaign("ended", "store-a", p, { endsAt: new Date("2026-10-10T00:00:00.000Z") }),
    campaign("off", "store-a", p, { isActive: false }),
    campaign("no-discount", "store-a", p, { discountValue: null }),
  ], NOW, DEALS_CAMPAIGN_PRODUCT_LIMIT);
  assert.equal(result.groups.length, 0);
  assert.equal(result.promotedIds.size, 0);
});

test("hidden products stay promoted, so the 'Endirimli məhsullar' list still excludes them", () => {
  const many = Array.from({ length: 20 }, (_, i) => product(`p${i}`));
  const { groups, promotedIds } = groupDealsCampaignProducts([campaign("a", "store-a", many)], NOW, DEALS_CAMPAIGN_PRODUCT_LIMIT);
  assert.equal(groups[0].products.length, 12);
  assert.equal(promotedIds.size, 20);
  assert.ok(promotedIds.has("p19"));
});

test("?campaign= accepts an id only and the link keeps the city", () => {
  assert.equal(dealsCampaignParam("cmabc123"), "cmabc123");
  assert.equal(dealsCampaignParam(["cm1", "cm2"]), "cm1");
  assert.equal(dealsCampaignParam(undefined), null);
  assert.equal(dealsCampaignParam(""), null);
  assert.equal(dealsCampaignParam("x' OR 1=1"), null);
  assert.equal(dealsCampaignParam("a".repeat(65)), null);
  assert.equal(dealsCampaignHref("cm1"), "/deals?campaign=cm1");
  assert.equal(dealsCampaignHref("cm1", "qazax"), "/deals?campaign=cm1&city=qazax");
});

test("/deals uses the shared rules, a defined product order, the cap and the per-campaign link", () => {
  const source = readFileSync(join(process.cwd(), "app/(customer)/deals/page.tsx"), "utf8");
  assert.match(source, /groupDealsCampaignProducts\(eligibleCampaigns, now, campaignId \? null : DEALS_CAMPAIGN_PRODUCT_LIMIT\)/);
  assert.match(source, /orderBy: \[\{ createdAt: "asc" \}, \{ id: "asc" \}\],\s*\},\s*\},\s*orderBy: \[\{ startsAt: "asc" \}, \{ id: "asc" \}\], take: 24/);
  assert.match(source, /dealsCampaignHref\(campaign\.id, city\)/);
  assert.match(source, /Hamısına bax/);
  assert.doesNotMatch(source, /calculateEffectivePrice/, "the price rule lives only in lib/deals-campaigns.ts");
});

test("homepage 'Endirimli məhsullar' candidates are ordered by createdAt with an id tie-breaker", () => {
  const source = readFileSync(join(process.cwd(), "app/(customer)/(home)/page.tsx"), "utf8");
  assert.match(source, /discountPrice: \{ not: null \} \},\s*take: 40,\s*(\/\/[^\n]*\n\s*)?orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\],/);
});
