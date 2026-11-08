import { NextRequest, NextResponse } from "next/server";
import { csrfRejection } from "@/lib/csrf";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { homeBannerSchema } from "@/lib/site-content";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ bannerId: string }> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const { bannerId } = await params;
  const raw: unknown = await request.json().catch(() => null);
  const parsed = homeBannerSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Banner məlumatlarını yoxlayın", details: parsed.error.flatten() }, { status: 422 });

  try {
    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.homeBanner.update({ where: { id: bannerId }, data: parsed.data });
      await tx.auditLog.create({ data: { actorId: admin.id, action: "HOME_BANNER_UPDATE", entityType: "HomeBanner", entityId: updated.id } });
      return updated;
    });
    return NextResponse.json({ item, message: "Banner yeniləndi." });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P2025") return NextResponse.json({ error: "Banner tapılmadı" }, { status: 404 });
    throw error;
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ bannerId: string }> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const { bannerId } = await params;
  const changed = await prisma.$transaction(async (tx) => {
    const result = await tx.homeBanner.updateMany({ where: { id: bannerId, isActive: true }, data: { isActive: false } });
    if (result.count) await tx.auditLog.create({ data: { actorId: admin.id, action: "HOME_BANNER_DEACTIVATE", entityType: "HomeBanner", entityId: bannerId } });
    return result.count;
  });
  if (!changed) return NextResponse.json({ error: "Aktiv banner tapılmadı" }, { status: 404 });
  return NextResponse.json({ deactivated: true, message: "Banner deaktiv edildi." });
}
