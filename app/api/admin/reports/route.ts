import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildAdminReportCsv } from "@/lib/admin-report-csv";
import { formatLocalDateInput, parseLocalDateRange } from "@/lib/admin-report-dates";
import { summarizeDeliveredSales } from "@/lib/admin-sales-report";
import { summarizeMonthlyStoreSales } from "@/lib/store-monthly-sales";

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

  const where = {
    status: "DELIVERED" as const,
    OR: [{ deliveredAt: { gte: from, lte: to } }, { deliveredAt: null, createdAt: { gte: from, lte: to } }],
    ...(filters.data.storeId ? { storeId: filters.data.storeId } : {}),
    ...(filters.data.cityId ? { store: { cityId: filters.data.cityId } } : {}),
  };
  const [orders, stores] = await Promise.all([
    prisma.storeOrder.findMany({
      where,
      include: {
        store: { select: { id: true, name: true } },
        items: true,
        returnRequests: { where: { status: "REFUNDED" }, select: { orderItemId: true, status: true, refundAmount: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.store.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const sales = summarizeDeliveredSales(orders);
  const monthly = summarizeMonthlyStoreSales(orders);
  const storeNames = new Map(stores.map((store) => [store.id, store.name]));
  const rows: (string | number | null)[][] = [[
    "type", "period", "store_or_product", "orders_or_lines", "quantity", "net_sales_azn", "commission_rate", "commission_azn",
  ]];
  for (const row of sales.daily) rows.push(["daily", row.id, "", row.count, row.quantity, (row.revenueCents / 100).toFixed(2), null, null]);
  for (const row of monthly) rows.push([
    "monthly_store_commission", row.month, storeNames.get(row.storeId) ?? row.storeId, row.orders, null,
    (row.salesCents / 100).toFixed(2), row.rate === null ? null : `${(row.rate * 100).toFixed(2)}%`,
    row.commissionCents === null ? null : (row.commissionCents / 100).toFixed(2),
  ]);
  for (const row of sales.byStore) rows.push(["store", "", storeNames.get(row.id) ?? row.id, row.count, row.quantity, (row.revenueCents / 100).toFixed(2), null, null]);
  for (const row of sales.byProduct) rows.push(["product", "", row.id, row.count, row.quantity, (row.revenueCents / 100).toFixed(2), null, null]);

  const filename = `bagati-sales-${formatLocalDateInput(from)}-${formatLocalDateInput(to)}.csv`;
  return new NextResponse(`\uFEFF${buildAdminReportCsv(rows)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
