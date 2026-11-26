import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatLocalDateInput, parseLocalDateRange } from "@/lib/admin-report-dates";
import { ADMIN_LIST_EXPORT_RATE_LIMIT } from "@/lib/admin-power-1";
import { adminListExportAuditData } from "@/lib/admin-list-export";
import { buildAdminSalesExport } from "@/lib/admin-reports-export";
import { allowAdminRequest } from "@/lib/admin-request-limit";
import { rateLimitedResponse } from "@/lib/rate-limit-response";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });

  const query = request.nextUrl.searchParams;
  const filters = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    storeId: z.string().max(191).optional(),
    cityId: z.string().max(191).optional(),
  }).safeParse({
    from: query.get("from") || undefined,
    to: query.get("to") || undefined,
    storeId: query.get("storeId") || undefined,
    cityId: query.get("cityId") || undefined,
  });
  if (!filters.success) return NextResponse.json({ error: "Hesabat filtrlərini yoxlayın" }, { status: 422 });

  const defaultFrom = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const fromRange = filters.data.from ? parseLocalDateRange(filters.data.from) : null;
  const toRange = filters.data.to ? parseLocalDateRange(filters.data.to) : null;
  if ((filters.data.from && !fromRange) || (filters.data.to && !toRange)) {
    return NextResponse.json({ error: "Tarix mövcud deyil" }, { status: 422 });
  }
  const from = fromRange?.start ?? defaultFrom;
  const to = toRange?.end ?? new Date();
  if (from > to) return NextResponse.json({ error: "Başlanğıc tarixi son tarixdən sonra ola bilməz" }, { status: 422 });
  if (to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: "CSV ixracı ən çox 366 günlük aralıq üçün mümkündür" }, { status: 422 });
  }

  // ADMIN-3-EXPORTS-1: shared admin export rate limit, bounded read (lib/admin-reports-export.ts), one ADMIN_LIST_EXPORT
  // audit row ("reports"). Truncation is signalled like the list export (X-Export-Truncated), without a message.
  if (!allowAdminRequest("admin-list-export", admin.id, request.headers, ADMIN_LIST_EXPORT_RATE_LIMIT)) return rateLimitedResponse(60);
  const result = await buildAdminSalesExport(prisma, { from, to, storeId: filters.data.storeId, cityId: filters.data.cityId });
  await prisma.auditLog.create({ data: adminListExportAuditData(admin.id, "reports", result) });

  const filename = `bagati-sales-${formatLocalDateInput(from)}-${formatLocalDateInput(to)}.csv`;
  return new NextResponse(result.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Export-Rows": String(result.rowCount),
      "X-Export-Truncated": result.truncated ? "1" : "0",
    },
  });
}
