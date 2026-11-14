/**
 * Admin order list filters. "Gözləyən sifarişlər" on the dashboard counts every not-yet-finished order status;
 * the orders list accepts the same group (?status=pending) so the dashboard link shows exactly what it counts.
 * Pure: read-only filter helpers for the admin list; no order processing logic.
 */
export const ADMIN_PENDING_ORDER_STATUSES = ["PENDING", "NEW", "CONFIRMED", "PREPARING", "READY", "PROCESSING"] as const;
export const ADMIN_PENDING_ORDER_GROUP = "pending";
export const ADMIN_PENDING_ORDERS_HREF = `/admin/orders?status=${ADMIN_PENDING_ORDER_GROUP}`;

/** Prisma `status` condition for the orders list: one known status, the pending group, or no condition. */
export function adminOrderStatusWhere(raw: string | undefined, statuses: readonly string[]): { status?: string | { in: string[] } } {
  if (raw === ADMIN_PENDING_ORDER_GROUP) return { status: { in: [...ADMIN_PENDING_ORDER_STATUSES] } };
  if (raw && statuses.includes(raw)) return { status: raw };
  return {};
}
