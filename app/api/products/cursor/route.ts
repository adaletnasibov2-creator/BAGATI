import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createPrismaPublicProductCatalogClient, findPublicProductCatalogPage, publicProductCatalogCursorResponse } from "@/lib/public-product-catalog";
import { normalizeProductCatalogSort } from "@/lib/catalog-sort";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  city: z.string().max(80).optional(),
  category: z.string().max(120).optional(),
  q: z.string().trim().max(120).optional(),
  sort: z.enum(["newest", "name"]).optional(),
  cursor: z.string().max(1024).optional(),
});

const productInclude = {
  store: { select: { id: true, name: true, city: { select: { name: true, slug: true } } } },
  category: true,
  brand: true,
  inventory: { select: { variantId: true, quantity: true, reserved: true } },
  variants: { where: { isActive: true }, select: { inventory: { select: { quantity: true, reserved: true } } } },
} satisfies Prisma.ProductInclude;

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Sorğu parametrləri yanlışdır" }, { status: 400 });
  const { city, category, q, cursor } = parsed.data;
  const sort = normalizeProductCatalogSort(parsed.data.sort);
  try {
    const page = await prisma.$transaction(
      (tx) => findPublicProductCatalogPage(
        createPrismaPublicProductCatalogClient(tx, productInclude),
        { citySlug: city, categorySlug: category, query: q, searchFields: "name" },
        { sort, limit: 20, paginate: true, ...(cursor !== undefined ? { cursor } : {}) },
      ),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return NextResponse.json(publicProductCatalogCursorResponse(page), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RangeError && error.message.includes("CURSOR_INVALID")) {
      return NextResponse.json({ error: "Səhifələmə keçidi yanlışdır" }, { status: 400 });
    }
    throw error;
  }
}
