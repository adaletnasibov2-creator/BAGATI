import { Prisma, type PrismaClient } from "@prisma/client";
import { publicProductCatalogCandidateWhere, type PublicProductCatalogFilters } from "@/lib/public-product-catalog";
import { publicProductVisibilityWhere } from "@/lib/store-visibility";

/**
 * GET /api/products (offset listing) limits (SCALE-FIX-1, 2026-11-19). Before this, the route counted every public
 * product inside one interactive RepeatableRead transaction and failed with P2028 after 5 s at 50k products, holding a
 * pool connection for the whole time. Now:
 *  - no interactive transaction: plain reads, each holding a connection only while it runs;
 *  - offset paging is capped at PUBLIC_PRODUCTS_API_MAX_RESULTS results (page * limit); deeper pages use the cursor API;
 *  - `total` is one SQL COUNT with the public visibility rules (the same kind of count the store page uses), bounded by
 *    a statement timeout; if it does not finish in time, `total` is null and the items are still returned.
 */
export const PUBLIC_PRODUCTS_API_MAX_RESULTS = 1000;
export const PUBLIC_PRODUCTS_API_COUNT_TIMEOUT_MS = 2000;

export function publicProductsApiPageTooDeep(page: number, limit: number): boolean {
  return (page - 1) * limit + limit > PUBLIC_PRODUCTS_API_MAX_RESULTS;
}

/** Product filters of the count: the catalog filters (city, category, name search) plus the full public visibility. */
export function publicProductsApiCountWhere(filters: PublicProductCatalogFilters, now: Date): Prisma.ProductWhereInput {
  return { AND: [publicProductCatalogCandidateWhere(filters, now), publicProductVisibilityWhere(undefined, now)] };
}

type CountClient = Pick<PrismaClient, "$transaction" | "$executeRawUnsafe" | "product">;

/**
 * One short batch transaction: `SET LOCAL statement_timeout` then the COUNT, so the connection is held at most
 * PUBLIC_PRODUCTS_API_COUNT_TIMEOUT_MS. A failure is logged (code only, never the query) and returns null.
 */
export async function countPublicProductsForApi(client: CountClient, filters: PublicProductCatalogFilters, now: Date): Promise<number | null> {
  try {
    const [, total] = await client.$transaction([
      client.$executeRawUnsafe(`SET LOCAL statement_timeout = ${Math.trunc(PUBLIC_PRODUCTS_API_COUNT_TIMEOUT_MS)}`),
      client.product.count({ where: publicProductsApiCountWhere(filters, now) }),
    ]);
    return total;
  } catch (error) {
    const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : error instanceof Error ? error.name : "UNKNOWN";
    console.warn(JSON.stringify({ event: "public_products_api.count_failed", code }));
    return null;
  }
}
