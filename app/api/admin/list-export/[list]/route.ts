/**
 * ADMIN-POWER-1: GET /api/admin/list-export/{stores|orders|customers|seller-applications}?<the list's filters>
 * ADMIN only (403), in-process rate limit per admin and IP (429), unknown list 404, bounded to 5000 rows,
 * formula-safe CSV, one ADMIN_LIST_EXPORT audit row per export (lib/admin-list-export.ts). Never cached.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ADMIN_LIST_EXPORT_RATE_LIMIT, ADMIN_LIST_EXPORTS, bakuDateKey, type AdminListExport } from "@/lib/admin-power-1";
import { adminListExportAuditData, buildAdminListExport } from "@/lib/admin-list-export";
import { allowAdminRequest } from "@/lib/admin-request-limit";
import { rateLimitedResponse } from "@/lib/rate-limit-response";

export const dynamic = "force-dynamic";
const PRIVATE = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest, { params }: { params: Promise<{ list: string }> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403, headers: PRIVATE });
  const { list } = await params;
  if (!(ADMIN_LIST_EXPORTS as readonly string[]).includes(list)) return NextResponse.json({ error: "İxrac filtrlərini yoxlayın" }, { status: 404, headers: PRIVATE });
  if (!allowAdminRequest("admin-list-export", admin.id, request.headers, ADMIN_LIST_EXPORT_RATE_LIMIT)) return rateLimitedResponse(60);
  const result = await buildAdminListExport(prisma, list as AdminListExport, Object.fromEntries(request.nextUrl.searchParams));
  await prisma.auditLog.create({ data: adminListExportAuditData(admin.id, list as AdminListExport, result) });
  return new NextResponse(result.csv, {
    headers: {
      ...PRIVATE,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bagati-${list}-${bakuDateKey(new Date())}.csv"`,
      "X-Content-Type-Options": "nosniff",
      "X-Export-Rows": String(result.rowCount),
      "X-Export-Truncated": result.truncated ? "1" : "0",
    },
  });
}
