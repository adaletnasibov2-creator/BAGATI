import type { Prisma } from "@prisma/client";
import { calculateEffectivePrice, type PromotionPriceInput } from "@/lib/promotion-pricing";

/** At most this many products per campaign on /deals; "Hamısına bax" opens /deals?campaign=<id> with all of them. */
export const DEALS_CAMPAIGN_PRODUCT_LIMIT = 12;

type StockRow = { quantity: number; reserved: number; variantId?: string | null };
export type DealsCampaignProduct = {
  id: string;
  storeId: string;
  price: Prisma.Decimal.Value;
  discountPrice: Prisma.Decimal.Value | null;
  store: { id: string };
  inventory: StockRow[];
  variants: { inventory: StockRow[] }[];
};
export type DealsCampaign<P extends DealsCampaignProduct> = PromotionPriceInput & {
  storeId: string | null;
  products: { product: P }[];
};
export type DealsCampaignGroup<C, P> = {
  campaign: C;
  /** Shown products, in the campaign's product order, at most `limit`. */
  products: Array<P & { storeId: string; effectivePrice: string; campaignName: string }>;
  /** Every product of this campaign that passed the rules (shown or not). */
  total: number;
};

function hasSellableStock(product: DealsCampaignProduct): boolean {
  const rows = product.variants.length
    ? product.variants.flatMap((variant) => variant.inventory)
    : product.inventory.filter((row) => row.variantId == null);
  return rows.some((row) => row.quantity - row.reserved > 0);
}

/**
 * The /deals campaign rules, unchanged from the inline version: campaigns in the given order; a product counts only
 * for its own store's campaign, only once (first campaign wins), only with sellable stock, and only when the campaign
 * really lowers its price. `limit` caps what is shown per campaign (null = all). `promotedIds` holds every product that
 * passed, shown or not, so the "Endirimli məhsullar" list keeps excluding all of them, as before.
 */
export function groupDealsCampaignProducts<C extends DealsCampaign<DealsCampaignProduct>, P extends DealsCampaignProduct = C["products"][number]["product"]>(
  campaigns: readonly C[],
  now: Date,
  limit: number | null,
): { groups: DealsCampaignGroup<C, P>[]; promotedIds: Set<string> } {
  const promotedIds = new Set<string>();
  const groups: DealsCampaignGroup<C, P>[] = [];
  for (const campaign of campaigns) {
    const passed: DealsCampaignGroup<C, P>["products"] = [];
    for (const link of campaign.products) {
      const product = link.product as P;
      if (campaign.storeId !== product.storeId || promotedIds.has(product.id) || !hasSellableStock(product)) continue;
      const effective = calculateEffectivePrice(product.price, product.discountPrice, [campaign], now);
      if (!effective.promotion) continue;
      promotedIds.add(product.id);
      passed.push({ ...product, storeId: product.store.id, effectivePrice: effective.unitPrice.toFixed(2), campaignName: campaign.name });
    }
    if (passed.length) groups.push({ campaign, products: limit === null ? passed : passed.slice(0, limit), total: passed.length });
  }
  return { groups, promotedIds };
}

/** The ?campaign= value: a cuid-like id or nothing. Anything else is ignored. */
export function dealsCampaignParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : null;
}

export function dealsCampaignHref(campaignId: string, city?: string | null): string {
  const params = new URLSearchParams({ campaign: campaignId });
  if (city) params.set("city", city);
  return `/deals?${params.toString()}`;
}
