/**
 * Homepage "Kampaniyada" shelf: the products of up to 8 promotional campaigns in ONE query (it used to be one query
 * per campaign). Same per-campaign product filter (ACTIVE, the campaign's own store, the public store filter, in
 * stock) and the same order (product name, then id); the first `limit` rows per campaign are kept in memory.
 *
 * No `take` in SQL: Prisma cannot limit per campaign. The fetch is bounded because both promotion write paths cap a
 * promotion at 100 products (vendor campaigns route and adminPromotionSchema), so at most campaigns x 100 rows.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { groupCampaignProductRows } from "@/lib/homepage-campaign-products";

export const homepageCampaignProductSelect = {
  id: true, storeId: true, name: true, price: true, discountPrice: true, images: true,
  store: { select: { id: true, name: true } },
  inventory: { select: { variantId: true, quantity: true, reserved: true, lowStockThreshold: true } },
  variants: { where: { isActive: true }, select: { isActive: true, inventory: { select: { quantity: true, reserved: true, lowStockThreshold: true } } } },
} satisfies Prisma.ProductSelect;

type CampaignRef = { id: string; storeId?: string | null };
type Reader = Pick<PrismaClient, "promotionProduct" | "inventory">;

/** The product filter one campaign used before, unchanged. */
export function homepageCampaignProductWhere(db: Pick<PrismaClient, "inventory">, storeId: string, storeFilter: Prisma.StoreWhereInput): Prisma.ProductWhereInput {
  return {
    status: "ACTIVE", storeId, store: storeFilter, OR: [
      { variants: { none: { isActive: true } }, inventory: { some: { variantId: null, quantity: { gt: db.inventory.fields.reserved } } } },
      { variants: { some: { isActive: true, inventory: { some: { quantity: { gt: db.inventory.fields.reserved } } } } } },
    ],
  };
}

export async function findHomepageCampaignProductBatches(db: Reader, campaigns: readonly CampaignRef[], storeFilter: Prisma.StoreWhereInput, limit = 10) {
  if (!campaigns.length) return [];
  const rows = await db.promotionProduct.findMany({
    where: { OR: campaigns.map((campaign) => ({ promotionId: campaign.id, product: homepageCampaignProductWhere(db, campaign.storeId!, storeFilter) })) },
    orderBy: [{ product: { name: "asc" } }, { product: { id: "asc" } }],
    select: { promotionId: true, product: { select: homepageCampaignProductSelect } },
  });
  return groupCampaignProductRows(campaigns.map((campaign) => campaign.id), rows, limit);
}
