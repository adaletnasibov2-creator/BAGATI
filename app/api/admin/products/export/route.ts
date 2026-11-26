import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ADMIN_LIST_EXPORT_RATE_LIMIT } from "@/lib/admin-power-1";
import { adminListExportAuditData } from "@/lib/admin-list-export";
import { buildProductsExport } from "@/lib/admin-products-export";
import { allowAdminRequest } from "@/lib/admin-request-limit";
import { rateLimitedResponse } from "@/lib/rate-limit-response";

/**
 * Admin products CSV. ADMIN-3-EXPORTS-1: the list export's protections (lib/admin-products-export.ts): at most
 * ADMIN_LIST_EXPORT_MAX_ROWS rows (truncation in X-Export-Truncated, as the list export), the shared admin export rate
 * limit (429) and one ADMIN_LIST_EXPORT audit row ("products"). Filters and CSV format unchanged.
 */
export const dynamic = "force-dynamic";
const exportQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  storeId: z.string().max(80).optional(),
  categoryId: z.string().max(80).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
}).strict();

export async function GET(request: NextRequest) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });

  const parsed = exportQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "İxrac filtrlərini yoxlayın" }, { status: 422 });
  if (!allowAdminRequest("admin-list-export", admin.id, request.headers, ADMIN_LIST_EXPORT_RATE_LIMIT)) return rateLimitedResponse(60);

  const result = await buildProductsExport(prisma, parsed.data);
  await prisma.auditLog.create({ data: adminListExportAuditData(admin.id, "products", result) });
  return new Response(result.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="bagati-products.csv"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Export-Rows": String(result.rowCount),
      "X-Export-Truncated": result.truncated ? "1" : "0",
    },
  });
}
