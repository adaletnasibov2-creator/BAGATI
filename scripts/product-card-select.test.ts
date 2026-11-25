/**
 * Lighter product cards (SCALE-FIX-2 A5): card lists select only the columns the card renders and only promotions that
 * are on and not ended. The card output (price, campaign, stock, variants, PRO badge, links) must not change.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Prisma } from "@prisma/client";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ProductGrid, type DisplayProduct } from "../components/product-grid";
import {
  productCardPromotionLinks,
  productCardScalarSelect,
  productCardSelect,
  productListCardSelect,
} from "../lib/product-card-select";
import { homeProductCardSelect } from "../lib/home-page-data";
import { calculateEffectivePrice, productPromotions, type PromotionPriceInput } from "../lib/promotion-pricing";

// Components use the classic JSX runtime under tsx (same as scripts/design-home.test.ts).
(globalThis as { React?: typeof React }).React = React;

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const NOW = new Date("2026-11-19T12:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

test("a card selects only the columns it renders: no description or other long columns", () => {
  assert.deepEqual(Object.keys(productCardScalarSelect).sort(), ["discountPrice", "id", "images", "name", "price", "storeId"]);
  for (const select of [productCardSelect(NOW), productListCardSelect(NOW), homeProductCardSelect(NOW)]) {
    const keys = Object.keys(select);
    for (const heavy of ["description", "specs", "attributes", "seoTitle", "seoDescription", "slug", "sku"]) {
      assert.ok(!keys.includes(heavy), heavy);
    }
    assert.ok(!("include" in select));
    assert.deepEqual(select.promotionProducts, productCardPromotionLinks(NOW));
  }
  // The list and home cards show no PRO badge: store name and id only (two fewer queries per page).
  assert.deepEqual(productListCardSelect(NOW).store, { select: { id: true, name: true } });
  assert.deepEqual(homeProductCardSelect(NOW).store, { select: { id: true, name: true } });
  // ProductGrid pages keep the PRO-badge fields.
  assert.deepEqual(Object.keys(productCardSelect(NOW).store.select).sort(), ["id", "isActive", "name", "status", "subscription"]);
});

test("promotion links: only switched-on promotions that have not ended, with the fields the price rule reads", () => {
  const links = productCardPromotionLinks(NOW);
  assert.deepEqual(links.where, { promotion: { isActive: true, endsAt: { gte: NOW } } });
  assert.deepEqual(Object.keys(links.select.promotion.select).sort(), ["discountType", "discountValue", "endsAt", "id", "isActive", "name", "startsAt", "storeId"]);
});

test("the promotion filter never changes the card price or campaign name", () => {
  const promotion = (id: string, overrides: Partial<PromotionPriceInput>): PromotionPriceInput => ({
    id, storeId: "s1", name: id, startsAt: at(-60), endsAt: at(60), isActive: true, discountType: "PERCENT", discountValue: new Prisma.Decimal(10), ...overrides,
  });
  const all = [
    promotion("active", {}),
    promotion("active-later-start", { startsAt: at(-30), discountValue: new Prisma.Decimal(30) }),
    promotion("disabled", { isActive: false, discountValue: new Prisma.Decimal(50) }),
    promotion("ended", { endsAt: at(-1), discountValue: new Prisma.Decimal(40) }),
    promotion("ends-now", { endsAt: NOW, discountValue: new Prisma.Decimal(20) }),
    promotion("scheduled", { startsAt: at(5), discountValue: new Prisma.Decimal(25) }),
    promotion("other-store", { storeId: "s2", discountValue: new Prisma.Decimal(60) }),
    promotion("fixed", { discountType: "FIXED", discountValue: new Prisma.Decimal(3) }),
  ];
  // What the database returns with the filter (isActive AND endsAt >= query time).
  const filtered = all.filter((item) => item.isActive && item.endsAt.getTime() >= NOW.getTime());
  for (const renderAt of [NOW, at(0.5), at(6), at(61)]) {
    for (const [price, manual] of [["100.00", null], ["100.00", "95.00"], ["2.50", null]] as const) {
      const before = calculateEffectivePrice(price, manual, productPromotions(all.map((p) => ({ promotion: p })), "s1"), renderAt);
      const after = calculateEffectivePrice(price, manual, productPromotions(filtered.map((p) => ({ promotion: p })), "s1"), renderAt);
      assert.equal(after.unitPrice.toFixed(2), before.unitPrice.toFixed(2), `${price} at ${renderAt.toISOString()}`);
      assert.equal(after.promotion?.id ?? null, before.promotion?.id ?? null);
    }
  }
});

test("ProductGrid renders the same HTML from a full row and from the card select", () => {
  const fullRow = {
    id: "p1", storeId: "s1", categoryId: "c1", brandId: null, sku: "SKU-1", name: "Kətan köynək", slug: "keten-koynek",
    description: "Uzun təsvir ".repeat(400), price: new Prisma.Decimal("120.00"), discountPrice: new Prisma.Decimal("99.90"),
    images: ["/images/a.webp", "/images/b.webp", "/images/c.webp"], status: "ACTIVE", createdAt: NOW, updatedAt: NOW,
    store: { id: "s1", name: "Qazax Moda", isActive: true, status: "ACTIVE", subscription: { status: "ACTIVE", currentPeriodEnd: at(60 * 24 * 30), plan: { slug: "pro", isActive: true } } },
    inventory: [{ variantId: null, quantity: 3, reserved: 1 }],
    variants: [
      { id: "v1", isActive: true, inventory: [{ quantity: 2, reserved: 0 }] },
      { id: "v2", isActive: true, inventory: [{ quantity: 1, reserved: 1 }] },
    ],
  };
  const pick = (row: typeof fullRow) => ({
    id: row.id, storeId: row.storeId, name: row.name, price: row.price, discountPrice: row.discountPrice, images: row.images,
    store: row.store, inventory: row.inventory, variants: row.variants,
  });
  // The card is a client component that uses the app router (cart and favourite buttons): a stub router is enough here.
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
  const render = (product: unknown) => renderToStaticMarkup(createElement(
    AppRouterContext.Provider, { value: router as never }, createElement(ProductGrid, { products: [product as DisplayProduct] }),
  ));
  for (const extra of [{}, { effectivePrice: "90.00", campaignName: "Payız endirimi" }]) {
    const before = render({ ...fullRow, ...extra });
    const after = render({ ...pick(fullRow), ...extra });
    assert.equal(after, before);
    assert.match(after, /Kətan köynək/);
    assert.match(after, /PRO mağaza/, "PRO badge from the store's subscription");
    assert.match(after, /1 variant/, "in-stock variant count");
    assert.match(after, /120\.00 ₼/, "original price"); // PRICE-SYMBOL-1: the card always shows 2 decimals (was "120 ₼")
    assert.doesNotMatch(after, /Uzun təsvir/, "the card never showed the description");
  }
});

test("card pages read card rows with a select, never full rows or every promotion ever attached", () => {
  const pages = [
    "app/(customer)/products/(list)/page.tsx",
    "app/(customer)/categories/page.tsx",
    "app/(customer)/new-products/page.tsx",
    "app/(customer)/deals/page.tsx",
    "app/(customer)/stores/[storeId]/page.tsx",
    "lib/home-page-data.ts",
  ];
  for (const path of pages) {
    const source = read(path);
    assert.doesNotMatch(source, /include: \{ promotion: true \}/, `${path}: no unfiltered promotion include`);
    assert.match(source, /product-card-select|homeProductCardSelect/, path);
  }
  assert.match(read("app/(customer)/products/(list)/page.tsx"), /createPrismaPublicProductCatalogSelectClient\(prisma, productSelect\)/);
  assert.equal(read("lib/home-page-data.ts").match(/select: homeProductCardSelect\(now\)/g)?.length, 4, "newest, discounted, popular, featured");
  const store = read("app/(customer)/stores/[storeId]/page.tsx");
  assert.match(store, /where: catalogWhere,\s*\/\/[^\n]*\n\s*select: \{ \.\.\.productCardScalarSelect, store: \{ select: productCardStoreSelect \}, \.\.\.productCardStockSelect \}/);
  assert.match(store, /product: \{ select: \{ \.\.\.productCardScalarSelect, \.\.\.productCardStockSelect \} \}/);
  const deals = read("app/(customer)/deals/page.tsx");
  assert.equal(deals.match(/\.\.\.productCardScalarSelect, store: \{ select: productCardStoreSelect \}, \.\.\.productCardStockSelect/g)?.length, 2);
  // The JSON APIs keep their response shape (favourites and quick-add read it): unchanged in A5.
  assert.match(read("app/api/products/route.ts"), /createPrismaPublicProductCatalogClient\(prisma, productInclude\)/);
});
