import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createPrismaPublicProductCatalogClient, findPublicProductCatalogPage } from "@/lib/public-product-catalog";
import { productQuerySchema } from "@/lib/validation";

const productInclude = {
  store: { select: { id: true, name: true, city: { select: { name: true, slug: true } } } },
  category: true,
  brand: true,
  inventory: { select: { variantId: true, quantity: true, reserved: true } },
  variants: { where: { isActive: true }, select: { inventory: { select: { quantity: true, reserved: true } } } },
} satisfies Prisma.ProductInclude;

export async function GET(request: NextRequest) {
  const parsed = productQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Sorğu parametrləri yanlışdır", details: parsed.error.flatten() }, { status: 400 });
  const { city, category, q, page, limit } = parsed.data;
  const result = await prisma.$transaction((tx) => findPublicProductCatalogPage(
    createPrismaPublicProductCatalogClient(tx, productInclude),
    { citySlug: city, categorySlug: category, query: q, searchFields: "name" },
    { sort: "newest", offset: (page - 1) * limit, limit, exactTotal: true },
  ), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  return NextResponse.json({ items: result.items, page, limit, total: result.total });
}

export const dynamic = "force-dynamic";
