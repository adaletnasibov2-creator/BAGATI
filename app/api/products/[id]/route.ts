import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolvePublicStoreEligibility } from "@/lib/store-eligibility";
import { publicProductVisibilityWhere } from "@/lib/store-visibility";
import { publicProductDetailInclude } from "@/lib/public-product-batch";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await prisma.product.findFirst({
    where: { id, ...publicProductVisibilityWhere() },
    include: publicProductDetailInclude, // shared with the batch read (GET /api/products?ids=)
  });
  if (!item) return NextResponse.json({ error: "Məhsul tapılmadı" }, { status: 404 });
  const eligible = await resolvePublicStoreEligibility([item.store.id]);
  if (!eligible.has(item.store.id)) return NextResponse.json({ error: "Məhsul tapılmadı" }, { status: 404 });
  return NextResponse.json({ item });
}

export const dynamic = "force-dynamic";
