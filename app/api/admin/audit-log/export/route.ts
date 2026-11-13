import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeAdminSearchParams } from "@/lib/admin-pagination";
import { parseAuditLogFilters } from "@/lib/admin-audit-log";
import { exportAuditLogCsv } from "@/lib/admin-audit-log-query";

export const dynamic = "force-dynamic";

/** CSV of the filtered audit log (max 10,000 rows). ADMIN only; the export itself is audited as AUDIT_EXPORT. */
export async function GET(request: NextRequest) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const { filters, errors } = parseAuditLogFilters(normalizeAdminSearchParams(Object.fromEntries(request.nextUrl.searchParams)));
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
