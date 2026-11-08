import { prisma } from "@/lib/prisma";

export type StorefrontBrandingCompatibility = {
  available: boolean;
  bannerUrl: string | null;
  theme: string;
};

export async function getStorefrontBrandingCompatibility(storeId: string): Promise<StorefrontBrandingCompatibility | null> {
  const [row] = await prisma.$queryRaw<{
    available: boolean;
    bannerUrl: string | null;
    theme: string | null;
  }[]>`
    SELECT
      to_jsonb(store_record) ? 'bannerUrl' AND to_jsonb(store_record) ? 'theme' AS "available",
      to_jsonb(store_record)->>'bannerUrl' AS "bannerUrl",
      to_jsonb(store_record)->>'theme' AS "theme"
    FROM "Store" AS store_record
    WHERE store_record.id = ${storeId}
  `;

  return row ? {
    available: row.available,
    bannerUrl: row.bannerUrl,
    theme: row.theme ?? "forest",
  } : null;
}

export async function isStorefrontAssetReferenced(storeId: string, url: string): Promise<boolean> {
  const [row] = await prisma.$queryRaw<{ referenced: boolean }[]>`
    SELECT
      to_jsonb(store_record)->>'logoUrl' = ${url}
      OR to_jsonb(store_record)->>'bannerUrl' = ${url} AS "referenced"
    FROM "Store" AS store_record
    WHERE store_record.id = ${storeId}
  `;

  return row?.referenced ?? false;
}
