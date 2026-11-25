/**
 * ADMIN-POWER-1: CSV of the CURRENT filtered admin list ("CSV ixrac et"): stores, orders, customers, seller applications.
 * - the same filter and order as the list page (lib/admin-list-where.ts, sellerApplicationListWhere);
 * - bounded: one read of at most ADMIN_LIST_EXPORT_MAX_ROWS + 1 rows (the extra row only tells "truncated");
 * - only display fields: no password hash, tokens, full VÖEN (masked), addresses or notes;
 * - formula-safe cells and a BOM (buildAdminListCsv);
 * - one audit row per export (owner decision B1) written after the read, with the list name, the filter keys,
 *   whether a search text was used (never the text itself), the row count and "truncated".
 * The products list keeps its existing export (owner decision C1).
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { adminStatusLabel } from "@/lib/admin-labels";
import { normalizeAdminEnumFilter, normalizeAdminSearch, normalizeAdminSearchParams, type AdminSearchParams } from "@/lib/admin-pagination";
import { customersListWhere, ordersListWhere, storesListWhere } from "@/lib/admin-list-where";
import { ADMIN_LIST_EXPORT_ACTION, ADMIN_LIST_EXPORT_MAX_ROWS, buildAdminListCsv, capRows, type AdminListExport } from "@/lib/admin-power-1";
import type { AdminReportCsvRow } from "@/lib/admin-report-csv";
import { formatBakuDateTime } from "@/lib/admin-audit-log";
import { priceAmount } from "@/lib/price";
import { maskVoen, SELLER_APPLICATION_SOURCE_LABELS, SELLER_TYPE_LABELS } from "@/lib/seller-application";
import { sellerApplicationListOrder, sellerApplicationListWhere, type SellerApplicationListFilters } from "@/lib/seller-application-service";

type Db = Pick<PrismaClient, "store" | "order" | "user" | "vendorApplication" | "auditLog">;
export type AdminListCsv = { csv: string; rowCount: number; truncated: boolean; filterKeys: string[]; searched: boolean };

export const ADMIN_LIST_EXPORT_HEADERS: Record<AdminListExport, readonly string[]> = {
  stores: ["id", "name", "status", "public", "city", "seller", "seller_email", "plan", "products", "orders", "created_at"],
  orders: ["number", "customer_email", "stores", "status", "total", "created_at_baku"],
  customers: ["id", "name", "email", "phone", "active", "orders", "created_at"],
  "seller-applications": ["submitted_at_baku", "applicant_email", "seller_name", "type", "voen_masked", "status", "source"],
};

const APPLICATION_STATUSES = ["PENDING", "APPROVED", "REJECTED", "WITHDRAWN", "ALL"] as const;
const take = ADMIN_LIST_EXPORT_MAX_ROWS + 1;
const day = (date: Date) => formatBakuDateTime(date).slice(0, 10);

async function rowsFor(db: Db, list: AdminListExport, sp: Record<string, string | undefined>, q: string): Promise<AdminReportCsvRow[]> {
  if (list === "stores") {
    const rows = await db.store.findMany({ where: storesListWhere(sp, q), orderBy: { createdAt: "desc" }, take, select: { id: true, name: true, status: true, isActive: true, adminManaged: true, createdAt: true, city: { select: { name: true } }, vendor: { select: { displayName: true, user: { select: { email: true } } } }, subscription: { select: { status: true, plan: { select: { name: true } } } }, _count: { select: { products: true, storeOrders: true } } } });
    return rows.map((r) => [r.id, r.name, adminStatusLabel("store", r.status), r.status === "ACTIVE" && r.isActive ? "true" : "false", r.city?.name ?? "", r.vendor?.displayName ?? "", r.vendor?.user?.email ?? "", r.adminManaged ? "Admin tərəfindən · ödənişsiz" : r.subscription ? [r.subscription.plan?.name, adminStatusLabel("subscription", r.subscription.status)].filter(Boolean).join(" · ") : "", r._count.products, r._count.storeOrders, day(r.createdAt)]);
  }
  if (list === "orders") {
    const rows = await db.order.findMany({ where: ordersListWhere(sp, q), orderBy: { createdAt: "desc" }, take, select: { id: true, status: true, total: true, createdAt: true, user: { select: { email: true } }, storeOrders: { select: { store: { select: { name: true } } } } } });
    return rows.map((r) => [`#${r.id.slice(-8).toUpperCase()}`, r.user.email, r.storeOrders.map((s) => s.store.name).join(", "), adminStatusLabel("order", r.status), priceAmount(r.total) ?? "", formatBakuDateTime(r.createdAt)]);
  }
  if (list === "customers") {
    const rows = await db.user.findMany({ where: customersListWhere(sp, q), orderBy: { createdAt: "desc" }, take, select: { id: true, email: true, isActive: true, createdAt: true, customerProfile: { select: { firstName: true, lastName: true, phone: true } }, _count: { select: { orders: true } } } });
    return rows.map((r) => [r.id, [r.customerProfile?.firstName, r.customerProfile?.lastName].filter(Boolean).join(" "), r.email, r.customerProfile?.phone ?? "", r.isActive ? "true" : "false", r._count.orders, day(r.createdAt)]);
  }
  const filters: SellerApplicationListFilters = { status: normalizeAdminEnumFilter(sp.status, APPLICATION_STATUSES) ?? "PENDING", q: q.slice(0, 100) };
  const rows = await db.vendorApplication.findMany({ where: sellerApplicationListWhere(filters), orderBy: sellerApplicationListOrder(filters), take, select: { createdAt: true, displayName: true, sellerType: true, voenNormalized: true, status: true, source: true, user: { select: { email: true } } } });
  return rows.map((r) => [formatBakuDateTime(r.createdAt), r.user.email, r.displayName, r.sellerType ? SELLER_TYPE_LABELS[r.sellerType] : "", maskVoen(r.voenNormalized), r.status, SELLER_APPLICATION_SOURCE_LABELS[r.source]]);
}

/** Reads the filtered list (the page's own filter params) and builds the CSV. */
export async function buildAdminListExport(db: Db, list: AdminListExport, rawParams: AdminSearchParams): Promise<AdminListCsv> {
  const sp = normalizeAdminSearchParams(rawParams);
  const q = normalizeAdminSearch(sp.q);
  const { rows, truncated } = capRows(await rowsFor(db, list, sp, q));
  const filterKeys = Object.keys(sp).filter((key) => key !== "q" && key !== "page" && Boolean(sp[key])).sort();
  return { csv: buildAdminListCsv(ADMIN_LIST_EXPORT_HEADERS[list], rows), rowCount: rows.length, truncated, filterKeys, searched: Boolean(q) };
}

/** The audit row (decision B1): after the read, so it never counts itself. No search text, no personal data. */
export function adminListExportAuditData(adminId: string, list: AdminListExport, result: AdminListCsv): Prisma.AuditLogUncheckedCreateInput {
  return { actorId: adminId, action: ADMIN_LIST_EXPORT_ACTION, entityType: "AdminList", entityId: list, metadata: { list, filterKeys: result.filterKeys, searched: result.searched, rowCount: result.rowCount, truncated: result.truncated, maxRows: ADMIN_LIST_EXPORT_MAX_ROWS } };
}
