import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { csrfRejection } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { readJsonBodyLimited } from "@/lib/request-json";
import { contentPageRestoreSchema, isContentPageSlug } from "@/lib/content-pages";
import { ContentPageError, restoreContentRevision } from "@/lib/content-pages-admin";
import { logSecurityOperationFailure } from "@/lib/security-logging";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** "Bu versiyaya qayıt": copies an old revision into a NEW revision (never deletes) + audit. Same order as the save route. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403, headers });
  const { slug } = await params;
  if (!isContentPageSlug(slug)) return NextResponse.json({ error: "Səhifə tapılmadı" }, { status: 404, headers });
  const body = await readJsonBodyLimited(request, 1024);
  if (!body.ok) return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: body.status, headers });
  const parsed = contentPageRestoreSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: 400, headers });
  try {
    const { page, revision } = await restoreContentRevision(prisma, { slug, actorId: admin.id, ...parsed.data });
    return NextResponse.json({ message: "Versiya bərpa edildi.", updatedAt: page.updatedAt.toISOString(), revisionId: revision.id }, { headers });
  } catch (error) {
    if (error instanceof ContentPageError) {
      return error.code === "CONFLICT"
        ? NextResponse.json({ error: "Səhifə bu vaxt başqa admin tərəfindən dəyişdirilib. Səhifəni yeniləyin.", code: "CONFLICT" }, { status: 409, headers })
        : NextResponse.json({ error: "Versiya tapılmadı" }, { status: 404, headers });
    }
    logSecurityOperationFailure("content_page_restore", error);
    return NextResponse.json({ error: "Bərpa etmək alınmadı." }, { status: 503, headers });
  }
}
