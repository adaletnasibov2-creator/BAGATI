import { NextRequest, NextResponse } from "next/server";
import { csrfRejection } from "@/lib/csrf";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SITE_SETTINGS_DEFAULTS, siteSettingsSchema } from "@/lib/site-content";
import { invalidateSiteSettingsCache } from "@/lib/site-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const settings = await prisma.siteSettings.findUnique({ where: { id: SITE_SETTINGS_DEFAULTS.id } });
  return NextResponse.json({ item: settings ?? SITE_SETTINGS_DEFAULTS }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: NextRequest) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;

  const raw: unknown = await request.json().catch(() => null);
  const parsed = siteSettingsSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Sayt parametrlərini yoxlayın", details: parsed.error.flatten() }, { status: 422 });

  const item = await prisma.$transaction(async (tx) => {
    const settings = await tx.siteSettings.upsert({
      where: { id: SITE_SETTINGS_DEFAULTS.id },
      create: { ...SITE_SETTINGS_DEFAULTS, ...parsed.data },
      update: parsed.data,
    });
    await tx.auditLog.create({
      data: {
        actorId: admin.id,
        action: "SITE_SETTINGS_UPDATE",
        entityType: "SiteSettings",
        entityId: settings.id,
        metadata: { changedFields: Object.keys(parsed.data) },
      },
    });
    return settings;
  });
  invalidateSiteSettingsCache();

  return NextResponse.json({ item, message: "Sayt parametrləri yadda saxlanıldı." });
}
