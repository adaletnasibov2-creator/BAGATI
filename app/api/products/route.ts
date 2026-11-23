import { NextRequest, NextResponse } from "next/server";
import { allowPublicSearch } from "@/lib/public-search-rate-limit";
import { rateLimitedResponse } from "@/lib/rate-limit-response";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createPrismaPublicProductCatalogClient, findPublicProductCatalogPage } from "@/lib/public-product-catalog";
import { productQuerySchema } from "@/lib/validation";
import { findPublicProductsByIds, parseProductIdsParam } from "@/lib/public-product-batch";
import { countPublicProductsForApi, PUBLIC_PRODUCTS_API_MAX_RESULTS, publicProductsApiPageTooDeep } from "@/lib/public-products-api";

const productInclude = {
  store: { select: { id: true, name: true, city: { select: { name: true, slug: true } } } },
  category: true,
  brand: true,
  inventory: { select: { variantId: true, quantity: true, reserved: true } },
  variants: { where: { isActive: true }, select: { inventory: { select: { quantity: true, reserved: true } } } },
} satisfies Prisma.ProductInclude;

export async function GET(request: NextRequest) {
  // SEC-FIX-2 L8: in-process budget for public search / catalog GETs (no DB call); the existing rate-limit text.
  if (!allowPublicSearch(request.headers)) return rateLimitedResponse(60);
  // Favorites: GET /api/products?ids=a,b,c (max 50) -> { items } in request order, same rules as /api/products/[id].
  if (request.nextUrl.searchParams.has("ids")) {
    const ids = parseProductIdsParam(request.nextUrl.searchParams.get("ids"));
    if ("error" in ids) return NextResponse.json({ error: ids.error }, { status: 400 });
    return NextResponse.json({ items: await findPublicProductsByIds(ids.ids) });
  }
  const parsed = productQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Sorğu parametrləri yanlışdır", details: parsed.error.flatten() }, { status: 400 });
  const { city, category, q, page, limit } = parsed.data;
  // Offset paging re-scans every earlier row, so it stops at PUBLIC_PRODUCTS_API_MAX_RESULTS; the cursor API has no
  // depth limit (lib/public-products-api.ts).
  if (publicProductsApiPageTooDeep(page, limit)) {
    return NextResponse.json({
      error: `Bu səhifə çox dərindir: ilk ${PUBLIC_PRODUCTS_API_MAX_RESULTS} məhsuldan sonrası üçün /api/products/cursor istifadə edin.`,
      code: "PAGE_TOO_DEEP",
      maxResults: PUBLIC_PRODUCTS_API_MAX_RESULTS,
    }, { status: 400 });
  }
  const filters = { citySlug: city, categorySlug: category, query: q, searchFields: "name" as const };
  const now = new Date();
  // Plain reads, no interactive transaction: no pool connection is held for the whole scan (SCALE-FIX-1).
  const [result, total] = await Promise.all([
    findPublicProductCatalogPage(
      createPrismaPublicProductCatalogClient(prisma, productInclude),
      filters,
      { sort: "newest", now, offset: (page - 1) * limit, limit, allowMissingRecords: true },
    ),
    countPublicProductsForApi(prisma, filters, now),
  ]);
  return NextResponse.json({ items: result.items, page, limit, total });
}

export const dynamic = "force-dynamic";
