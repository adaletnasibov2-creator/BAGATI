import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });

  const parsed = z.string().trim().max(120).safeParse(request.nextUrl.searchParams.get("q") ?? "");
  if (!parsed.success) return NextResponse.json({ error: "Axtarış mətni çox uzundur" }, { status: 422 });
  const query = parsed.data;
  const items = await prisma.store.findMany({
    where: query ? {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { vendor: { displayName: { contains: query, mode: "insensitive" } } },
      ],
    } : {},
    select: { id: true, name: true, status: true, vendor: { select: { displayName: true } } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 25,
  });

  return NextResponse.json({
    items: items.map(({ vendor, ...store }) => ({ ...store, vendorName: vendor.displayName })),
  }, { headers: { "Cache-Control": "no-store" } });
}
