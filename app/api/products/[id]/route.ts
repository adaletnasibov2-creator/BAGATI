import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolvePublicStoreEligibility } from "@/lib/store-eligibility";
import { publicProductVisibilityWhere } from "@/lib/store-visibility";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await prisma.product.findFirst({
    where: { id, ...publicProductVisibilityWhere() },
    include: {
      store: { select: { id: true, name: true, slug: true, city: { select: { name: true } } } },
      variants: { where: { isActive: true } },
      category: true,
      brand: true,
      inventory: { select: { quantity: true, reserved: true } },
    },
  });
  if (!item) return NextResponse.json({ error: "Məhsul tapılmadı" }, { status: 404 });
  const eligible = await resolvePublicStoreEligibility([item.store.id]);
  if (!eligible.has(item.store.id)) return NextResponse.json({ error: "Məhsul tapılmadı" }, { status: 404 });
  return NextResponse.json({ item });
}

export const dynamic = "force-dynamic";
