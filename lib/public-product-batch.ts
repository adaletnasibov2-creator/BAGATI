/**
 * Batch read of public products by id, for the favorites page (GET /api/products?ids=a,b,c).
 * Same visibility rules and fields as GET /api/products/[id]: publicProductVisibilityWhere() in SQL, then
 * resolvePublicStoreEligibility for the stores found. Unknown, hidden and ineligible ids are left out, exactly as the
 * single endpoint answers 404 for them. Items come back in request order.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolvePublicStoreEligibility } from "@/lib/store-eligibility";
import { publicProductVisibilityWhere } from "@/lib/store-visibility";
import { PRODUCT_ID_PATTERN, PUBLIC_PRODUCT_BATCH_MAX_IDS } from "@/lib/product-id-batches";

export { PUBLIC_PRODUCT_BATCH_MAX_IDS };

/** The include of GET /api/products/[id]; both endpoints use this constant. */
export const publicProductDetailInclude = {
  store: { select: { id: true, name: true, slug: true, city: { select: { name: true } } } },
  variants: { where: { isActive: true } },
  category: true,
  brand: true,
  inventory: { select: { quantity: true, reserved: true } },
} satisfies Prisma.ProductInclude;

export type PublicProductDetail = Prisma.ProductGetPayload<{ include: typeof publicProductDetailInclude }>;

/**
 * "a,b,c" -> unique ids in first-seen order. More than 50 entries (before removing duplicates), an empty list or an id
 * outside [A-Za-z0-9_-]{1,64} is an error (400).
 */
export function parseProductIdsParam(raw: string | null): { ids: string[] } | { error: string } {
  const entries = (raw ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!entries.length) return { error: "Məhsul identifikatorları göndərilməyib" };
  if (entries.length > PUBLIC_PRODUCT_BATCH_MAX_IDS) return { error: `Bir sorğuda ən çox ${PUBLIC_PRODUCT_BATCH_MAX_IDS} məhsul ola bilər` };
  if (entries.some((entry) => !PRODUCT_ID_PATTERN.test(entry))) return { error: "Məhsul identifikatoru yanlışdır" };
  return { ids: [...new Set(entries)] };
}

export type PublicProductBatchDeps<T extends { id: string; store: { id: string } }> = {
  findProducts: (ids: string[]) => Promise<T[]>;
  resolveEligibleStores: (storeIds: string[]) => Promise<Set<string>>;
};

const defaultDeps: PublicProductBatchDeps<PublicProductDetail> = {
  findProducts: (ids) => prisma.product.findMany({ where: { id: { in: ids }, ...publicProductVisibilityWhere() }, include: publicProductDetailInclude }),
  resolveEligibleStores: (storeIds) => resolvePublicStoreEligibility(storeIds),
};

export async function findPublicProductsByIds(ids: string[]): Promise<PublicProductDetail[]>;
export async function findPublicProductsByIds<T extends { id: string; store: { id: string } }>(ids: string[], deps: PublicProductBatchDeps<T>): Promise<T[]>;
export async function findPublicProductsByIds(ids: string[], deps: PublicProductBatchDeps<{ id: string; store: { id: string } }> = defaultDeps) {
  if (ids.length > PUBLIC_PRODUCT_BATCH_MAX_IDS) throw new RangeError("PUBLIC_PRODUCT_BATCH_TOO_MANY_IDS");
  if (!ids.length) return [];
  const items = await deps.findProducts(ids);
  if (!items.length) return [];
  const eligible = await deps.resolveEligibleStores([...new Set(items.map((item) => item.store.id))]);
  const byId = new Map(items.filter((item) => eligible.has(item.store.id)).map((item) => [item.id, item]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}
