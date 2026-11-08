import { formatLocalReportDate } from "./admin-report-dates";

type MoneyValue = string | number | { toString(): string };

export type DeliveredSalesOrder = {
  id: string;
  storeId: string;
  status: string;
  createdAt: Date;
  deliveredAt: Date | null;
  subtotal: MoneyValue;
  items: {
    id: string;
    productName: string;
    quantity: number;
    lineTotal: MoneyValue;
  }[];
  returnRequests: {
    orderItemId: string;
    status: string;
    refundAmount: MoneyValue;
  }[];
};

export type SalesReportRow = {
  id: string;
  count: number;
  revenueCents: number;
  quantity: number;
};

export type DeliveredSalesSummary = {
  orders: number;
  revenueCents: number;
  quantity: number;
  daily: SalesReportRow[];
  byStore: SalesReportRow[];
  byProduct: SalesReportRow[];
};

function toCents(value: MoneyValue): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("Invalid monetary value");
  return Math.round(amount * 100);
}

export function summarizeDeliveredSales(
  orders: readonly DeliveredSalesOrder[],
): DeliveredSalesSummary {
  const daily = new Map<string, SalesReportRow>();
  const byStore = new Map<string, SalesReportRow>();
  const byProduct = new Map<string, SalesReportRow>();
  let revenueCents = 0;
  let quantity = 0;
  let salesOrders = 0;

  for (const order of orders) {
    if (order.status !== "DELIVERED") continue;

    const refundedByItem = new Map<string, number>();
    for (const request of order.returnRequests) {
      if (request.status !== "REFUNDED") continue;
      refundedByItem.set(
        request.orderItemId,
        (refundedByItem.get(request.orderItemId) ?? 0) + toCents(request.refundAmount),
      );
    }

    const grossCents = toCents(order.subtotal);
    const refundedCents = [...refundedByItem.values()].reduce((sum, amount) => sum + amount, 0);
    const netCents = Math.max(0, grossCents - Math.min(grossCents, refundedCents));

    const date = formatLocalReportDate(order.deliveredAt ?? order.createdAt);
    const dailyRow = daily.get(date) ?? { id: date, count: 0, revenueCents: 0, quantity: 0 };
    const storeRow = byStore.get(order.storeId) ?? { id: order.storeId, count: 0, revenueCents: 0, quantity: 0 };
    if (netCents > 0) {
      dailyRow.count++;
      dailyRow.revenueCents += netCents;
      storeRow.count++;
      storeRow.revenueCents += netCents;
      salesOrders++;
      revenueCents += netCents;
    }
    daily.set(date, dailyRow);
    byStore.set(order.storeId, storeRow);

    for (const item of order.items) {
      const itemGrossCents = toCents(item.lineTotal);
      const itemNetCents = Math.max(
        0,
        itemGrossCents - Math.min(itemGrossCents, refundedByItem.get(item.id) ?? 0),
      );
      const productRow = byProduct.get(item.productName) ?? {
        id: item.productName,
        count: 0,
        revenueCents: 0,
        quantity: 0,
      };
      productRow.count++;
      productRow.revenueCents += itemNetCents;
      productRow.quantity += item.quantity;
      dailyRow.quantity += item.quantity;
      storeRow.quantity += item.quantity;
      quantity += item.quantity;
      byProduct.set(item.productName, productRow);
    }
  }

  return {
    orders: salesOrders,
    revenueCents,
    quantity,
    daily: [...daily.values()].sort((left, right) => left.id.localeCompare(right.id)),
    byStore: [...byStore.values()].sort((left, right) => left.id.localeCompare(right.id)),
    byProduct: [...byProduct.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}
