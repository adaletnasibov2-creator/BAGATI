/**
 * ADMIN-POWER-1: the filters of the admin stores, orders and customers lists in one place, so the list page and its
 * CSV export ("CSV ixrac et") always read exactly the same rows. Moved unchanged from app/admin/_sections/stores.tsx,
 * orders.tsx and customers.tsx (same conditions, same order).
 */
import type { Prisma } from "@prisma/client";
import { normalizeAdminEnumFilter } from "@/lib/admin-pagination";
import { adminOrderStatusWhere } from "@/lib/admin-order-filters";

export const ADMIN_STORE_STATUSES = ["DRAFT", "PENDING_REVIEW", "ACTIVE", "SUSPENDED", "REJECTED"];
export const ADMIN_ORDER_STATUSES = ["PENDING", "NEW", "CONFIRMED", "PREPARING", "READY", "HANDED_TO_COURIER", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED"];
export const ADMIN_PRODUCT_STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"];

export type AdminListParams = Record<string, string | undefined>;

/** Mağazalar: default hides only archived stores (SUSPENDED + inactive). */
export function storesListWhere(sp: AdminListParams, q: string): Prisma.StoreWhereInput {
  const storeStatus = normalizeAdminEnumFilter(sp.status, ADMIN_STORE_STATUSES);
  return {
    ...(storeStatus ? { status: storeStatus as Prisma.StoreWhereInput["status"] } : { NOT: { status: "SUSPENDED", isActive: false } }),
    ...(sp.cityId ? { cityId: sp.cityId } : {}),
    ...(sp.vendorId ? { vendorId: sp.vendorId } : {}),
    ...(q ? { OR: [
      { name: { contains: q, mode: "insensitive" } },
      { slug: { contains: q, mode: "insensitive" } },
      { vendor: { displayName: { contains: q, mode: "insensitive" } } },
      { vendor: { user: { email: { contains: q, mode: "insensitive" } } } },
    ] } : {}),
  };
}

/** Sifarişlər: status (or the "pending" group), store, Baku-agnostic date inputs (from inclusive, to + 1 day exclusive). */
export function ordersListWhere(sp: AdminListParams, q: string): Prisma.OrderWhereInput {
  const from = sp.from && Number.isFinite(Date.parse(sp.from)) ? new Date(sp.from) : undefined;
  const to = sp.to && Number.isFinite(Date.parse(sp.to)) ? new Date(sp.to) : undefined;
  if (to) to.setDate(to.getDate() + 1);
  return {
    ...(adminOrderStatusWhere(sp.status, ADMIN_ORDER_STATUSES) as Prisma.OrderWhereInput),
    ...(sp.storeId ? { storeOrders: { some: { storeId: sp.storeId } } } : {}),
    ...((from || to) ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
    ...(q ? { OR: [
      { id: { contains: q, mode: "insensitive" } },
      { user: { email: { contains: q, mode: "insensitive" } } },
      { storeOrders: { some: { store: { name: { contains: q, mode: "insensitive" } } } } },
    ] } : {}),
  };
}

/** Müştərilər: role CUSTOMER, optional active/inactive, search by e-mail and name. */
export function customersListWhere(sp: AdminListParams, q: string): Prisma.UserWhereInput {
  return {
    role: "CUSTOMER",
    ...(sp.status === "active" ? { isActive: true } : sp.status === "inactive" ? { isActive: false } : {}),
    ...(q ? { OR: [
      { email: { contains: q, mode: "insensitive" } },
      { customerProfile: { firstName: { contains: q, mode: "insensitive" } } },
      { customerProfile: { lastName: { contains: q, mode: "insensitive" } } },
    ] } : {}),
  };
}
