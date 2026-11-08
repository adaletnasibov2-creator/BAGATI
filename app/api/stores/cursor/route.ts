import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createPrismaPublicStoreDiscoveryClient, findPublicStoreDiscoveryCursorPage, publicStoreDiscoveryCursorResponse } from "@/lib/public-store-discovery";
import { STORE_SEARCH_MAX_LENGTH } from "@/lib/search-term";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 20;
const querySchema = z.object({
  city: z.string().trim().max(80).optional(),
  q: z.string().trim().max(STORE_SEARCH_MAX_LENGTH).optional(),
  cursor: z.string().max(1024).optional(),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Axtarış məlumatı yanlışdır" }, { status: 400 });
  const { city, q, cursor } = parsed.data;
  try {
    const page = await prisma.$transaction(
      (tx) => findPublicStoreDiscoveryCursorPage(
        createPrismaPublicStoreDiscoveryClient(tx),
        { citySlug: city || undefined, query: q || undefined },
        { pageSize: PAGE_SIZE, ...(cursor !== undefined ? { cursor } : {}) },
      ),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return NextResponse.json(publicStoreDiscoveryCursorResponse(page), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RangeError && error.message.includes("CURSOR_INVALID")) {
      return NextResponse.json({ error: "Səhifələmə keçidi yanlışdır" }, { status: 400 });
    }
    throw error;
  }
}
