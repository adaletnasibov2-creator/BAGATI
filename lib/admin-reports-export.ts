/**
 * ADMIN-3-EXPORTS-1: the sales report CSV (/api/admin/reports) with the list export's protections. The read of
 * delivered store orders is bounded to ADMIN_LIST_EXPORT_MAX_ROWS + 1 (oldest first, as before); when more match, the
 * file covers the first ADMIN_LIST_EXPORT_MAX_ROWS store orders and is marked truncated (X-Export-Truncated, as the
 * list export; no message). The CSV rows (daily, monthly per store with commission, per store, per product) are built
 * exactly as before and are also capped. The 366-day range limit stays in the route.
 */
import type { PrismaClient } from "@prisma/client";
import { buildAdminReportCsv } from "@/lib/admin-report-csv";
import { ADMIN_LIST_EXPORT_MAX_ROWS, capRows } from "@/lib/admin-power-1";
import { summarizeDeliveredSales } from "@/lib/admin-sales-report";
import { summarizeMonthlyStoreSales } from "@/lib/store-monthly-sales";

type Db = Pick<PrismaClient, "storeOrder" | "store">;
export type SalesExportFilters = { from: Date; to: Date; storeId?: string; cityId?: string };

export const SALES_EXPORT_HEADER = ["type", "period", "store_or_product", "orders_or_lines", "quantity", "net_sales_azn", "commission_rate", "commission_azn"] as const;

export function salesExportWhere(filters: SalesExportFilters) {
  return {
    status: "DELIVERED" as const,
    OR: [{ deliveredAt: { gte: filters.from, lte: filters.to } }, { deliveredAt: null, createdAt: { gte: filters.from, lte: filters.to } }],
    ...(filters.storeId ? { storeId: filters.storeId } : {}),
    ...(filters.cityId ? { store: { cityId: filters.cityId } } : {}),
  };
}

export async function buildAdminSalesExport(db: Db, filters: SalesExportFilters, max = ADMIN_LIST_EXPORT_MAX_ROWS) {
  const [read, stores] = await Promise.all([
    db.storeOrder.findMany({
      where: salesExportWhere(filters),
      include: {
        store: { select: { id: true, name: true } },
        items: true,
        returnRequests: { where: { status: "REFUNDED" }, select: { orderItemId: true, status: true, refundAmount: true } },
      },
      orderBy: { createdAt: "asc" },
      take: max + 1,
    }),
    db.store.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const orders = capRows(read, max);
  const sales = summarizeDeliveredSales(orders.rows);
  const monthly = summarizeMonthlyStoreSales(orders.rows);
  const storeNames = new Map(stores.map((store) => [store.id, store.name]));
  const data: (string | number | null)[][] = [];
  for (const row of sales.daily) data.push(["daily", row.id, "", row.count, row.quantity, (row.revenueCents / 100).toFixed(2), null, null]);
  for (const row of monthly) data.push([
    "monthly_store_commission", row.month, storeNames.get(row.storeId) ?? row.storeId, row.orders, null,
    (row.salesCents / 100).toFixed(2), row.rate === null ? null : `${(row.rate * 100).toFixed(2)}%`,
    row.commissionCents === null ? null : (row.commissionCents / 100).toFixed(2),
  ]);
  for (const row of sales.byStore) data.push(["store", "", storeNames.get(row.id) ?? row.id, row.count, row.quantity, (row.revenueCents / 100).toFixed(2), null, null]);
  for (const row of sales.byProduct) data.push(["product", "", row.id, row.count, row.quantity, (row.revenueCents / 100).toFixed(2), null, null]);
  const lines = capRows(data, max);
  const filterKeys = (["storeId", "cityId"] as const).filter((key) => Boolean(filters[key]));
  return {
    csv: `﻿${buildAdminReportCsv([[...SALES_EXPORT_HEADER], ...lines.rows])}`,
    rowCount: lines.rows.length,
    truncated: orders.truncated || lines.truncated,
    filterKeys: ["from", "to", ...filterKeys].sort(),
    searched: false,
  };
}
