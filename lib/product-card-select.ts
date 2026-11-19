/**
 * The product columns and relations a product card actually uses (SCALE-FIX-2 A5).
 *
 * Before, card lists loaded full Product rows (every column, including the long description, specs, SEO fields and
 * import metadata) and every PromotionProduct link ever attached to the product with the full Promotion row. In the
 * SCALE-1 load test these were the slowest statements (339 ms and 208 ms). The card renders only: name, price, legacy
 * discount, the first two images, store name and link, stock, number of in-stock variants, and the active campaign.
 *
 * Promotion links: only promotions that are switched on and have not ended. calculateEffectivePrice() ignores every
 * other promotion (promotionStatus() !== "ACTIVE"), so the price and campaign name on the card are unchanged. A
 * promotion that starts later is still loaded, so the price is right if it starts between the query and the render.
 */
import type { Prisma } from "@prisma/client";

/** Scalars of a card. storeId is used for the store link and for store eligibility. */
export const productCardScalarSelect = {
  id: true,
  storeId: true,
  name: true,
  price: true,
  discountPrice: true,
  images: true,
} satisfies Prisma.ProductSelect;

/** Store fields for the card and the PRO badge (ProductGrid). */
export const productCardStoreSelect = {
  id: true,
  name: true,
  isActive: true,
  status: true,
  subscription: { select: { status: true, currentPeriodEnd: true, plan: { select: { slug: true, isActive: true } } } },
} satisfies Prisma.StoreSelect;

/** Stock rows: product-level inventory, and the active variants with their inventory. */
export const productCardStockSelect = {
  inventory: { select: { variantId: true, quantity: true, reserved: true } },
  variants: { where: { isActive: true }, select: { id: true, isActive: true, inventory: { select: { quantity: true, reserved: true } } } },
} satisfies Prisma.ProductSelect;

export const productCardPromotionSelect = {
  id: true,
  storeId: true,
  name: true,
  startsAt: true,
  endsAt: true,
  isActive: true,
  discountType: true,
  discountValue: true,
} satisfies Prisma.PromotionSelect;

/** Promotion links a card can use at `now`: switched on and not ended (see the file comment). */
export function productCardPromotionLinks(now: Date) {
  return {
    where: { promotion: { isActive: true, endsAt: { gte: now } } },
    select: { promotion: { select: productCardPromotionSelect } },
  } satisfies Prisma.Product$promotionProductsArgs;
}

/** Store name and id only: pages whose cards show no PRO badge (product list, home). */
export const productCardStoreNameSelect = { id: true, name: true } satisfies Prisma.StoreSelect;

/** A full card row for ProductGrid pages (categories, new products): with the store's PRO-badge fields. */
export function productCardSelect(now: Date) {
  return {
    ...productCardScalarSelect,
    store: { select: productCardStoreSelect },
    ...productCardStockSelect,
    promotionProducts: productCardPromotionLinks(now),
  } satisfies Prisma.ProductSelect;
}

/** The product list's card row (no PRO badge on that page, so the store's name and id are enough). */
export function productListCardSelect(now: Date) {
  return {
    ...productCardScalarSelect,
    store: { select: productCardStoreNameSelect },
    ...productCardStockSelect,
    promotionProducts: productCardPromotionLinks(now),
  } satisfies Prisma.ProductSelect;
}
