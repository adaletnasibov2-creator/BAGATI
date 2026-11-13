import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { csrfRejection } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { readJsonBodyLimited } from "@/lib/request-json";
import { parseAuditLogFilters } from "@/lib/admin-audit-log";
import { exportAuditLogCsv } from "@/lib/admin-audit-log-query";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4_096;
const FILTER_KEYS = ["actor", "action", "entityType", "entityId", "from", "to", "q"] as const;

/**
 * CSV of the filtered audit log (max 10,000 rows). POST only: the export writes an AUDIT_EXPORT entry, so it is a
 * state-changing request and goes through the shared cross-site check (also enforced by middleware). GET is not
 * exported, so Next.js answers 405. ADMIN only.
 */
export async function POST(request: NextRequest) {
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });

  const body = await readJsonBodyLimited(request, MAX_BODY_BYTES);
  if (!body.ok) return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: body.status });
  const raw = body.value && typeof body.value === "object" && !Array.isArray(body.value) ? body.value as Record<string, unknown> : null;
  if (!raw) return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: 400 });
  const params: Record<string, string | undefined> = {};
  for (const key of FILTER_KEYS) {
    const value = raw[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string") return NextResponse.json({ error: "Filtrləri yoxlayın" }, { status: 422 });
    params[key] = value;
  }
  const { filters, errors } = parseAuditLogFilters(params);
  if (errors.length) return NextResponse.json({ error: "Filtrləri yoxlayın", details: errors }, { status: 422 });

  try {
    const { csv, rowCount, truncated } = await exportAuditLogCsv(prisma, admin.id, filters);
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="bagati-audit-log-${stamp}.csv"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Export-Row-Count": String(rowCount),
        "X-Export-Truncated": truncated ? "1" : "0",
      },
    });
  } catch (error) {
    console.error(`admin audit export failed (${error instanceof Error ? error.name : "unknown"})`);
    return NextResponse.json({ error: "İxrac hazırlanmadı. Filtrləri daraldıb yenidən cəhd edin." }, { status: 503 });
  }
}
