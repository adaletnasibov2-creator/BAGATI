/**
 * ADMIN-POWER-1: the filters of the admin stores, orders and customers lists in one place, so the list page and its
 * CSV export ("CSV ixrac et") always read exactly the same rows. Moved unchanged from app/admin/_sections/stores.tsx,
 * orders.tsx and customers.tsx (same conditions, same order).
 */
import type { Prisma } from "@prisma/client";
import { normalizeAdminEnumFilter } from "@/lib/admin-pagination";
import { adminOrderStatusWhere } from "@/lib/admin-order-filters";
import { escapeLikePattern } from "@/lib/admin-audit-log";

/**
 * ADMIN-DESIGN-2 (security): the ONE helper for every admin `?q=` filter. Prisma `contains` does not escape LIKE
 * wildcards (on 5433 "%" matched every row), so % _ and \ are escaped with escapeLikePattern and match literally.
 * Same fields and the same case-insensitive match as before; only the wildcard meaning is gone.
 */
export function adminSearchContains(q: string): { contains: string; mode: "insensitive" } {
  return { contains: escapeLikePattern(q), mode: "insensitive" };
}

/** Same, case-sensitive: for the fields that were searched without `mode` before (e.g. IP addresses). */
export function adminSearchContainsExact(q: string): { contains: string } {
  return { contains: escapeLikePattern(q) };
}

/** The escaped `%q%` pattern for raw SQL ILIKE/LIKE (PostgreSQL's default escape character is the backslash). */
export function adminLikePattern(q: string): string {
  return `%${escapeLikePattern(q)}%`;
}

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
      { name: adminSearchContains(q) },
      { slug: adminSearchContains(q) },
      { vendor: { displayName: adminSearchContains(q) } },
      { vendor: { user: { email: adminSearchContains(q) } } },
    ] } : {}),
  };
}

/**
 * ADMIN-3-EXPORTS-1: Abunəliklər (/admin/subscriptions). The existing status filter (subscription status; PENDING also
 * matches stores without a subscription) AND, when searching, the same four store fields as the stores list (store name,
 * slug, seller name, seller e-mail) through adminSearchContains.
 */
export const ADMIN_SUBSCRIPTION_STATUSES = ["PENDING", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED", "EXPIRED"] as const;
export function subscriptionsListWhere(sp: AdminListParams, q: string): Prisma.StoreWhereInput {
  const status = normalizeAdminEnumFilter(sp.status, ADMIN_SUBSCRIPTION_STATUSES);
  const statusWhere: Prisma.StoreWhereInput = status ? { OR: [{ subscription: { is: { status } } }, ...(status === "PENDING" ? [{ subscription: { is: null } }] : [])] } : {};
  const searchWhere: Prisma.StoreWhereInput = q ? { OR: [
    { name: adminSearchContains(q) },
    { slug: adminSearchContains(q) },
    { vendor: { displayName: adminSearchContains(q) } },
    { vendor: { user: { email: adminSearchContains(q) } } },
  ] } : {};
  return { AND: [statusWhere, searchWhere] };
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
      { id: adminSearchContains(q) },
      { user: { email: adminSearchContains(q) } },
      { storeOrders: { some: { store: { name: adminSearchContains(q) } } } },
    ] } : {}),
  };
}

/** Müştərilər: role CUSTOMER, optional active/inactive, search by e-mail and name. */
export function customersListWhere(sp: AdminListParams, q: string): Prisma.UserWhereInput {
  return {
    role: "CUSTOMER",
    ...(sp.status === "active" ? { isActive: true } : sp.status === "inactive" ? { isActive: false } : {}),
    ...(q ? { OR: [
      { email: adminSearchContains(q) },
      { customerProfile: { firstName: adminSearchContains(q) } },
      { customerProfile: { lastName: adminSearchContains(q) } },
    ] } : {}),
  };
}
