import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { groupCampaignProductRows, selectHomepageCampaignProducts, type HomepageCampaign, type HomepageCampaignProduct } from "../lib/homepage-campaign-products";

function campaign(id: string, storeId: string): HomepageCampaign {
  return { id, storeId, name: id, startsAt: new Date("2026-10-01T00:00:00.000Z"), endsAt: new Date("2026-11-01T00:00:00.000Z"), isActive: true, discountType: "PERCENT", discountValue: 10 };
}

function product(id: string, overrides: Partial<HomepageCampaignProduct> = {}): HomepageCampaignProduct {
  return {
    id, storeId: "store-a", name: id, price: 100, discountPrice: null, images: [],
    store: { id: "store-a", name: "Mağaza A" }, inventory: [{ variantId: null, quantity: 5, reserved: 0, lowStockThreshold: 2 }], variants: [],
    ...overrides,
  };
}

test("campaign product selection keeps campaign ordering, store ownership, stock, and non-stacking price rules", () => {
  const first = campaign("campaign-a", "store-a");
  const second = campaign("campaign-b", "store-b");
  const batches = [
    [
      product("wrong-store", { storeId: "store-b" }),
      product("reserved-out", { inventory: [{ variantId: null, quantity: 2, reserved: 2, lowStockThreshold: 2 }] }),
      product("first-valid"),
      product("duplicate"),
    ],
    [product("duplicate", { storeId: "store-b", store: { id: "store-b", name: "Mağaza B" } }), product("second-valid", { storeId: "store-b", store: { id: "store-b", name: "Mağaza B" } })],
  ];

  const result = selectHomepageCampaignProducts([first, second], batches, new Date("2026-10-15T00:00:00.000Z"), 10);
  assert.deepEqual([...result.keys()], ["first-valid", "duplicate", "second-valid"]);
  assert.equal(result.get("first-valid")?.price, "90.00");
  assert.equal(result.get("duplicate")?.campaign.id, "campaign-a");
  assert.equal(result.get("second-valid")?.campaign.id, "campaign-b");
});

test("homepage campaign cards stop at the visible limit and empty campaigns yield no fake entries", () => {
  const active = campaign("campaign-a", "store-a");
  const candidates = Array.from({ length: 12 }, (_, index) => product(`product-${index + 1}`));
  const result = selectHomepageCampaignProducts([active], [candidates], new Date("2026-10-15T00:00:00.000Z"), 10);
  assert.equal(result.size, 10);
  assert.equal(selectHomepageCampaignProducts([], [], new Date()).size, 0);
  assert.throws(() => selectHomepageCampaignProducts([active], [candidates], new Date(), 51), { message: "HOMEPAGE_CAMPAIGN_PRODUCT_LIMIT_INVALID" });
});

test("one combined campaign query is split into the same batches as one query per campaign", () => {
  // Global order of the combined query: product name, then id.
  const rows = [
    { promotionId: "p2", name: "Ayaqqabı", id: "x1" },
    { promotionId: "p1", name: "Bal", id: "a1" },
    { promotionId: "p1", name: "Bal", id: "a2" },
    { promotionId: "p3", name: "Çanta", id: "c1" },
    { promotionId: "p2", name: "Divan", id: "x2" },
    { promotionId: "p1", name: "Ətir", id: "a3" },
    { promotionId: "unknown", name: "Kitab", id: "u1" },
  ];
  const perCampaign = (id: string, limit: number) => rows.filter((row) => row.promotionId === id).slice(0, limit);
  for (const limit of [1, 2, 10]) {
    const batches = groupCampaignProductRows(["p1", "p2", "p3", "p4"], rows, limit);
    assert.deepEqual(batches, ["p1", "p2", "p3", "p4"].map((id) => perCampaign(id, limit)));
  }
  assert.deepEqual(groupCampaignProductRows(["p1", "p2"], rows, 2).map((batch) => batch.map((row) => row.id)), [["a1", "a2"], ["x1", "x2"]]);
  assert.deepEqual(groupCampaignProductRows([], rows), []);
  assert.throws(() => groupCampaignProductRows(["p1"], rows, 0), /HOMEPAGE_CAMPAIGN_PRODUCT_LIMIT_INVALID/);
});

test("the homepage runs one campaign product query, not one per campaign", () => {
  const page = readFileSync(join(__dirname, "..", "app", "(customer)", "(home)", "page.tsx"), "utf8");
  assert.match(page, /findHomepageCampaignProductBatches\(prisma, promotionalCampaigns, storeFilter, 10\)/);
  assert.doesNotMatch(page, /promotionalCampaigns\.map\(\(campaign\) => prisma\.promotionProduct\.findMany/);
});
