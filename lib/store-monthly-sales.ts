import { formatLocalReportMonth } from "./admin-report-dates";

type MoneyValue = string | number | { toString(): string };

export type StoreSalesOrder = {
  id: string;
  storeId: string;
  status: string;
  subtotal: MoneyValue;
  commissionRateSnapshot: MoneyValue | null;
  createdAt: Date;
  deliveredAt: Date | null;
  returnRequests: { status: string; refundAmount: MoneyValue }[];
};

export type MonthlyStoreSales = {
  storeId: string;
  month: string;
  orders: number;
  salesCents: number;
  commissionCents: number | null;
  rate: number | null;
  ordersWithoutRule: number;
};

function toCents(value: MoneyValue): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("Invalid monetary value");
  return Math.round(amount * 100);
}

export function summarizeMonthlyStoreSales(
  orders: readonly StoreSalesOrder[],
): MonthlyStoreSales[] {
  const seenOrders = new Set<string>();
  const grouped = new Map<string, MonthlyStoreSales & { rates: Set<number> }>();

  for (const order of orders) {
    if (order.status !== "DELIVERED" || seenOrders.has(order.id)) continue;
    seenOrders.add(order.id);

    const completedAt = order.deliveredAt ?? order.createdAt;
    const grossCents = toCents(order.subtotal);
    const refundedCents = order.returnRequests
      .filter((request) => request.status === "REFUNDED")
      .reduce((sum, request) => sum + toCents(request.refundAmount), 0);
    const salesCents = Math.max(0, grossCents - Math.min(grossCents, refundedCents));
    if (salesCents === 0) continue;

    const rate = order.commissionRateSnapshot === null
      ? null
      : Number(order.commissionRateSnapshot);
    const commissionCents = rate === null ? null : Math.round(salesCents * rate);
    const month = formatLocalReportMonth(completedAt);
    const key = `${order.storeId}:${month}`;
    const row = grouped.get(key) ?? {
      storeId: order.storeId,
      month,
      orders: 0,
      salesCents: 0,
      commissionCents: 0,
      rate,
      ordersWithoutRule: 0,
      rates: new Set<number>(),
    };

    row.orders++;
    row.salesCents += salesCents;
    if (commissionCents === null) {
      row.ordersWithoutRule++;
    } else {
      row.commissionCents = (row.commissionCents ?? 0) + commissionCents;
      if (rate !== null) row.rates.add(rate);
    }
    if (row.rate !== rate) row.rate = null;
    grouped.set(key, row);
  }

  return [...grouped.values()]
    .map(({ rates, ...row }) => ({
      ...row,
      commissionCents: row.ordersWithoutRule ? null : row.commissionCents,
      rate: row.ordersWithoutRule || rates.size !== 1 ? null : rates.values().next().value ?? null,
    }))
    .sort((left, right) => left.month.localeCompare(right.month) || left.storeId.localeCompare(right.storeId));
}
