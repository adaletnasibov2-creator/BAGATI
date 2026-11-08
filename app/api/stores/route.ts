import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { filterEligiblePublicStores } from "@/lib/store-eligibility";
import { publicStoreListingWhere } from "@/lib/store-visibility";

export async function GET(request: NextRequest) {
  const city = request.nextUrl.searchParams.get("city");
  const candidates = await prisma.store.findMany({
    where: publicStoreListingWhere({ citySlug: city }),
    select: { id: true, name: true, slug: true, description: true, logoUrl: true, city: { select: { name: true, slug: true } } },
    orderBy: { name: "asc" },
  });
  const stores = await filterEligiblePublicStores(candidates);
  return NextResponse.json({ items: stores });
}
