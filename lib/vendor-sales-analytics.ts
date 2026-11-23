/**
 * SELLER-ANALYTICS-1: seller order analytics. Pure and money-safe (integer cents); every number comes from real
 * store orders. Definitions:
 * - "Received orders": every store order CREATED in the selected range, whatever its status or payment state.
 *   While online payment (Epoint) is off, orders stay "Ödəniş gözləyir", so these are orders, NOT paid sales.
 * - "Order value": subtotal of received orders that are not CANCELLED (delivery fee excluded). Not money received.
 * - Sales, commission and earnings stay in lib/vendor-finance.ts (DELIVERED orders only).
 * - Day / week / month keys are the same as the delivered-sales table (lib/vendor-finance.ts), so both agree.
 */
import { VENDOR_ORDER_STATUSES } from "@/lib/order-status";
import { dayKey, monthKey, toCents, weekKey } from "@/lib/vendor-finance";

type MoneyValue = string | number | { toString(): string };

/** The longest range the analytics read (a year, plus a leap day). */
export const ANALYTICS_MAX_RANGE_DAYS = 366;
export const TOP_PRODUCTS_LIMIT = 5;
export const TOP_GROUPS_LIMIT = 6;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The one money format of the dashboard: AZN, two decimals, az-AZ grouping. */
export function formatAzn(cents: number): string {
  return `${(cents / 100).toLocaleString("az-AZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₼`;
}

export function rangeDays(start: Date, end: Date): number {
  return Math.ceil((end.getTime() - start.getTime() + 1) / DAY_MS);
}

export function analyticsRangeAllowed(start: Date, end: Date): boolean {
  return start.getTime() <= end.getTime() && rangeDays(start, end) <= ANALYTICS_MAX_RANGE_DAYS;
}

/** The previous period of the same length, ending just before `start`. */
export function previousRange(start: Date, end: Date): { start: Date; end: Date } {
  const duration = end.getTime() - start.getTime() + 1;
  return { start: new Date(start.getTime() - duration), end: new Date(start.getTime() - 1) };
}

export type Change =
  | { kind: "up" | "down"; percent: number }
  | { kind: "same"; percent: 0 }
  /** Nothing in the previous period, something now: no percentage can be computed. */
  | { kind: "new"; percent: null }
  /** Nothing in either period. */
  | { kind: "none"; percent: null };

/** Change against the previous period, rounded to a whole percent. Never divides by zero. */
export function percentChange(current: number, previous: number): Change {
  if (previous === 0) return current === 0 ? { kind: "none", percent: null } : { kind: "new", percent: null };
  const percent = Math.round(((current - previous) / previous) * 100);
  if (percent === 0) return { kind: "same", percent: 0 };
  return { kind: percent > 0 ? "up" : "down", percent: Math.abs(percent) };
}

export type ReceivedOrderRow = { status: string; subtotal: MoneyValue; createdAt: Date };
export type OrderBucket = { key: string; orders: number; valueCents: number };
export type StatusCount = { status: string; orders: number };

export type ReceivedOrdersSummary = {
  received: number;
  cancelled: number;
  returned: number;
  delivered: number;
  /** Not delivered, cancelled or returned. */
  open: number;
  /** Subtotal of received orders that are not cancelled. */
  orderValueCents: number;
  /** orderValueCents / not-cancelled orders; null when there is none. */
  averageOrderValueCents: number | null;
  /** cancelled / received, 0..1; null when nothing was received. */
  cancellationRate: number | null;
  byStatus: StatusCount[];
  /** Not-cancelled orders and their value per bucket (oldest first). */
  daily: OrderBucket[];
  weekly: OrderBucket[];
  monthly: OrderBucket[];
};

const STATUS_ORDER = ["PENDING", ...VENDOR_ORDER_STATUSES, "PROCESSING", "SHIPPED"];
const statusRank = (status: string) => {
  const index = STATUS_ORDER.indexOf(status);
  return index === -1 ? STATUS_ORDER.length : index;
};

function addBucket(map: Map<string, OrderBucket>, key: string, valueCents: number) {
  const row = map.get(key) ?? { key, orders: 0, valueCents: 0 };
  row.orders += 1;
  row.valueCents += valueCents;
  map.set(key, row);
}
const sorted = (map: Map<string, OrderBucket>) => [...map.values()].sort((a, b) => a.key.localeCompare(b.key));

export function summarizeReceivedOrders(rows: readonly ReceivedOrderRow[]): ReceivedOrdersSummary {
  const statusCounts = new Map<string, number>();
  const daily = new Map<string, OrderBucket>(), weekly = new Map<string, OrderBucket>(), monthly = new Map<string, OrderBucket>();
  let cancelled = 0, returned = 0, delivered = 0, orderValueCents = 0;
  for (const row of rows) {
    statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
    if (row.status === "CANCELLED") { cancelled += 1; continue; }
    if (row.status === "RETURNED") returned += 1;
    if (row.status === "DELIVERED") delivered += 1;
    const cents = toCents(row.subtotal);
    orderValueCents += cents;
    addBucket(daily, dayKey(row.createdAt), cents);
    addBucket(weekly, weekKey(row.createdAt), cents);
    addBucket(monthly, monthKey(row.createdAt), cents);
  }
  const received = rows.length;
  const kept = received - cancelled;
  return {
    received,
    cancelled,
    returned,
    delivered,
    open: received - cancelled - returned - delivered,
    orderValueCents,
    averageOrderValueCents: kept > 0 ? Math.round(orderValueCents / kept) : null,
    cancellationRate: received > 0 ? cancelled / received : null,
    byStatus: [...statusCounts].map(([status, orders]) => ({ status, orders })).sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.status.localeCompare(b.status)),
    daily: sorted(daily),
    weekly: sorted(weekly),
    monthly: sorted(monthly),
  };
}

/** Previous-period totals from a groupBy(status) result: received orders and not-cancelled value. */
export function summarizeStatusGroups(groups: readonly { status: string; orders: number; subtotal: MoneyValue | null }[]): { received: number; orderValueCents: number } {
  let received = 0, orderValueCents = 0;
  for (const group of groups) {
    received += group.orders;
    if (group.status !== "CANCELLED" && group.subtotal !== null) orderValueCents += toCents(group.subtotal);
  }
  return { received, orderValueCents };
}

export type ProductTotal = { productId: string; quantity: number; valueCents: number };
export type NamedTotal = { name: string; quantity: number; valueCents: number };

/** Highest value first; ties by quantity, then name, so the order is stable. */
export function topByValue<T extends { valueCents: number; quantity: number }>(rows: readonly T[], limit: number, name: (row: T) => string): T[] {
  return [...rows].sort((a, b) => b.valueCents - a.valueCents || b.quantity - a.quantity || name(a).localeCompare(name(b))).slice(0, limit);
}

/** Product totals -> category totals. A product without a category (or a missing product) counts under `uncategorized`. */
export function categoryTotals(products: readonly ProductTotal[], categoryOf: ReadonlyMap<string, string | null>, uncategorized: string): NamedTotal[] {
  const totals = new Map<string, NamedTotal>();
  for (const product of products) {
    const name = categoryOf.get(product.productId) ?? uncategorized;
    const row = totals.get(name) ?? { name, quantity: 0, valueCents: 0 };
    row.quantity += product.quantity;
    row.valueCents += product.valueCents;
    totals.set(name, row);
  }
  return topByValue([...totals.values()], Number.MAX_SAFE_INTEGER, (row) => row.name);
}

/** City rows from SQL (count may arrive as bigint); empty names become null. */
export function normalizeCityRows(rows: readonly { city: string | null; orders: number | bigint }[]): { city: string | null; orders: number }[] {
  return rows.map((row) => ({ city: row.city && row.city.trim() ? row.city.trim() : null, orders: Number(row.orders) }));
}

export type AnalyticsPeriod = "daily" | "weekly" | "monthly";
const KEY_OF: Record<AnalyticsPeriod, (date: Date) => string> = { daily: dayKey, weekly: weekKey, monthly: monthKey };

/**
 * Every day / week / month between `from` and `to` (local calendar, the same keys as the buckets), with 0 where
 * nothing was ordered, so a time chart never hides empty periods. Bounded by ANALYTICS_MAX_RANGE_DAYS.
 */
export function fillBuckets(buckets: readonly OrderBucket[], period: AnalyticsPeriod, from: Date, to: Date): OrderBucket[] {
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  const keys: string[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const last = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  for (let guard = 0; cursor.getTime() <= last.getTime() && guard <= ANALYTICS_MAX_RANGE_DAYS + 1; guard += 1) {
    const key = KEY_OF[period](cursor);
    if (keys[keys.length - 1] !== key) keys.push(key);
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys.map((key) => byKey.get(key) ?? { key, orders: 0, valueCents: 0 });
}

/** Bar length as a percentage of the largest value (0 when everything is 0). */
export function barPercent(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(2, Math.round((value / max) * 100));
}
