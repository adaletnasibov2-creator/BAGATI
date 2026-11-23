import { NextRequest, NextResponse } from "next/server";
import { allowPublicSearch } from "@/lib/public-search-rate-limit";
import { rateLimitedResponse } from "@/lib/rate-limit-response";
import { prisma } from "@/lib/prisma";
import { createPrismaPublicStoreDiscoveryClient, findPublicStoreDiscoveryCursorPage } from "@/lib/public-store-discovery";

export const dynamic = "force-dynamic";
const STORE_OPTION_PAGE_SIZE = 20;

export async function GET(request: NextRequest) {
  // SEC-FIX-2 L8: in-process budget for public search / catalog GETs (no DB call); the existing rate-limit text.
  if (!allowPublicSearch(request.headers)) return rateLimitedResponse(60);
  const city = request.nextUrl.searchParams.get("city")?.trim() || undefined;
  const rawQuery = request.nextUrl.searchParams.get("q");
  const query = rawQuery?.trim() || undefined;
  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
  if ((city && city.length > 80) || (query && query.length > 80) || (cursor && cursor.length > 1024)) {
    return NextResponse.json({ error: "Axtarış məlumatı yanlışdır" }, { status: 400 });
  }
  try {
    // Plain reads, no interactive transaction (SCALE-FIX-1): no pool connection is held for the whole scan.
    const page = await findPublicStoreDiscoveryCursorPage(
      createPrismaPublicStoreDiscoveryClient(prisma),
      { citySlug: city, query },
      { pageSize: STORE_OPTION_PAGE_SIZE, cursor, allowMissingRecords: true },
    );
    return NextResponse.json({ ...page, pageSize: STORE_OPTION_PAGE_SIZE }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RangeError && error.message.includes("CURSOR_INVALID")) {
      return NextResponse.json({ error: "Səhifələmə keçidi yanlışdır" }, { status: 400 });
    }
    throw error;
  }
}
