import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createPrismaPublicStoreDiscoveryClient, findPublicStoreDiscoveryCursorPage } from "@/lib/public-store-discovery";

export const dynamic = "force-dynamic";
const STORE_OPTION_PAGE_SIZE = 20;

export async function GET(request: NextRequest) {
  const city = request.nextUrl.searchParams.get("city")?.trim() || undefined;
  const rawQuery = request.nextUrl.searchParams.get("q");
  const query = rawQuery?.trim() || undefined;
  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
  if ((city && city.length > 80) || (query && query.length > 80) || (cursor && cursor.length > 1024)) {
    return NextResponse.json({ error: "Axtarış məlumatı yanlışdır" }, { status: 400 });
  }
  try {
    const page = await prisma.$transaction(
      (tx) => findPublicStoreDiscoveryCursorPage(createPrismaPublicStoreDiscoveryClient(tx), { citySlug: city, query }, { pageSize: STORE_OPTION_PAGE_SIZE, cursor }),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return NextResponse.json({ ...page, pageSize: STORE_OPTION_PAGE_SIZE }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RangeError && error.message.includes("CURSOR_INVALID")) {
      return NextResponse.json({ error: "Səhifələmə keçidi yanlışdır" }, { status: 400 });
    }
    throw error;
  }
}
