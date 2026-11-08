import { calculateEffectivePrice, type PromotionPriceInput } from "@/lib/promotion-pricing";
import type { Prisma } from "@prisma/client";

export type HomepageCampaignProduct = {
  id: string;
  storeId: string;
  name: string;
  price: Prisma.Decimal.Value;
  discountPrice: Prisma.Decimal.Value | null;
  images: string[];
  store: { id: string; name: string };
  inventory: { variantId?: string | null; quantity: number; reserved: number; lowStockThreshold: number }[];
  variants: { options: unknown; inventory: { quantity: number; reserved: number; lowStockThreshold: number }[] }[];
};

export type HomepageCampaign = PromotionPriceInput & { store?: { name: string } | null };
export type SelectedHomepageCampaignProduct = {
  product: HomepageCampaignProduct;
  campaign: HomepageCampaign;
  price: string;
  basePrice: string;
  discountLabel: string;
};

export function selectHomepageCampaignProducts(
  campaigns: HomepageCampaign[],
  productBatches: HomepageCampaignProduct[][],
  now: Date,
  limit = 10,
): Map<string, SelectedHomepageCampaignProduct> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new RangeError("HOMEPAGE_CAMPAIGN_PRODUCT_LIMIT_INVALID");
  const selected = new Map<string, SelectedHomepageCampaignProduct>();
  for (const [index, campaign] of campaigns.entries()) {
    for (const product of productBatches[index] ?? []) {
      if (campaign.storeId !== product.storeId || selected.has(product.id) || availableStock(product) <= 0) continue;
      const effective = calculateEffectivePrice(product.price, product.discountPrice, [campaign], now);
      if (!effective.promotion || !effective.discountAmount.gt(0)) continue;
      const percent = effective.discountAmount.mul(100).div(effective.basePrice).toDecimalPlaces(0).toString();
      selected.set(product.id, {
        product,
        campaign,
        price: effective.unitPrice.toFixed(2),
        basePrice: effective.basePrice.toFixed(2),
        discountLabel: `${percent}% endirim`,
      });
      if (selected.size >= limit) return selected;
    }
  }
  return selected;
}

function availableStock(product: HomepageCampaignProduct) {
  const rows = product.variants.length
    ? product.variants.flatMap((variant) => variant.inventory)
    : product.inventory.filter((row) => row.variantId == null);
  return rows.reduce((total, row) => total + Math.max(0, row.quantity - row.reserved), 0);
}
