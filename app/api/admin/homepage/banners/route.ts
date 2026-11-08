import { NextRequest, NextResponse } from "next/server";
import { csrfRejection } from "@/lib/csrf";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { homeBannerSchema } from "@/lib/site-content";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const items = await prisma.homeBanner.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] });
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const raw: unknown = await request.json().catch(() => null);
  const parsed = homeBannerSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Banner məlumatlarını yoxlayın", details: parsed.error.flatten() }, { status: 422 });

  const item = await prisma.$transaction(async (tx) => {
    const banner = await tx.homeBanner.create({ data: parsed.data });
    await tx.auditLog.create({ data: { actorId: admin.id, action: "HOME_BANNER_CREATE", entityType: "HomeBanner", entityId: banner.id } });
    return banner;
  });
  return NextResponse.json({ item, message: "Banner yaradıldı." }, { status: 201 });
}
