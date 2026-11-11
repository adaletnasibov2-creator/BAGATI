/**
 * Seller sales and earnings summary. Pure and money-safe (integer cents).
 *
 * Definitions match the admin monthly sales report (lib/store-monthly-sales.ts):
 * - A sale counts only when the store order is DELIVERED (delivery requires a PAID payment).
 * - Net sales = delivered subtotal minus REFUNDED return amounts.
 * - Platform commission = net sales x the commission rate snapshotted on the order.
 *   Orders without a rate snapshot are counted separately; no rate is guessed.
 * - "Estimated earnings" are net sales minus commission. They are NOT payouts:
 *   BAGATI has no settlement/payout records, so nothing here claims money was transferred.
 */
type MoneyValue = string | number | { toString(): string };

export type VendorFinanceOrder = {
  id: string;
  status: string;
  subtotal: MoneyValue;
  deliveryFee: MoneyValue;
  commissionRateSnapshot: MoneyValue | null;
  createdAt: Date;
  deliveredAt: Date | null;
  paymentStatuses: string[];
  itemQuantity: number;
  returnRequests: { status: string; refundAmount: MoneyValue }[];
};

export type FinanceBucket = {
  key: string;
  orders: number;
  quantity: number;
  netSalesCents: number;
  commissionCents: number;
  estimatedEarningsCents: number;
};

export type VendorFinanceSummary = {
  deliveredOrders: number;
  soldQuantity: number;
  grossSalesCents: number;
  refundedCents: number;
  netSalesCents: number;
  commissionCents: number;
  /** Net sales of delivered orders that have no commission rate snapshot. */
  salesWithoutCommissionRuleCents: number;
  ordersWithoutCommissionRule: number;
  estimatedEarningsCents: number;
  deliveryFeesCents: number;
  /** Open (not delivered/cancelled/returned) orders whose payment is not yet PAID. */
  awaitingPayment: { orders: number; amountCents: number };
  /** Open orders already PAID, waiting to be delivered. */
  paidInProgress: { orders: number; amountCents: number };
  daily: FinanceBucket[];
  weekly: FinanceBucket[];
  monthly: FinanceBucket[];
};

const OPEN_EXCLUDED = new Set(["DELIVERED", "CANCELLED", "RETURNED"]);

export function toCents(value: MoneyValue): number {
  const amount = Number(String(value));
  if (!Number.isFinite(amount)) throw new Error("INVALID_MONEY_VALUE");
  return Math.round(amount * 100);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** Local calendar day, matching the date filter the seller selected. */
export function dayKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Monday of the local week, as YYYY-MM-DD. */
export function weekKey(date: Date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - offset);
  return dayKey(monday);
}

export function monthKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function addToBucket(map: Map<string, FinanceBucket>, key: string, quantity: number, netCents: number, commissionCents: number) {
  const row = map.get(key) ?? { key, orders: 0, quantity: 0, netSalesCents: 0, commissionCents: 0, estimatedEarningsCents: 0 };
  row.orders++;
  row.quantity += quantity;
  row.netSalesCents += netCents;
  row.commissionCents += commissionCents;
  row.estimatedEarningsCents += netCents - commissionCents;
  map.set(key, row);
}

const sortedBuckets = (map: Map<string, FinanceBucket>) => [...map.values()].sort((a, b) => a.key.localeCompare(b.key));

export function summarizeVendorFinance(orders: readonly VendorFinanceOrder[]): VendorFinanceSummary {
  const seen = new Set<string>();
  const daily = new Map<string, FinanceBucket>(), weekly = new Map<string, FinanceBucket>(), monthly = new Map<string, FinanceBucket>();
  const summary: VendorFinanceSummary = {
    deliveredOrders: 0, soldQuantity: 0, grossSalesCents: 0, refundedCents: 0, netSalesCents: 0,
    commissionCents: 0, salesWithoutCommissionRuleCents: 0, ordersWithoutCommissionRule: 0,
    estimatedEarningsCents: 0, deliveryFeesCents: 0,
    awaitingPayment: { orders: 0, amountCents: 0 }, paidInProgress: { orders: 0, amountCents: 0 },
    daily: [], weekly: [], monthly: [],
  };

  for (const order of orders) {
    if (seen.has(order.id)) continue;
    seen.add(order.id);
    const subtotalCents = toCents(order.subtotal);

    if (!OPEN_EXCLUDED.has(order.status)) {
      const bucket = order.paymentStatuses.includes("PAID") ? summary.paidInProgress : summary.awaitingPayment;
      bucket.orders++;
      bucket.amountCents += subtotalCents + toCents(order.deliveryFee);
      continue;
    }
    if (order.status !== "DELIVERED") continue;

    const refundedCents = Math.min(
      subtotalCents,
      order.returnRequests.filter((request) => request.status === "REFUNDED").reduce((sum, request) => sum + toCents(request.refundAmount), 0),
    );
    const netCents = subtotalCents - refundedCents;
    const rate = order.commissionRateSnapshot === null ? null : Number(String(order.commissionRateSnapshot));
    const commissionCents = rate === null || !Number.isFinite(rate) ? 0 : Math.round(netCents * rate);

    summary.deliveredOrders++;
    summary.soldQuantity += order.itemQuantity;
    summary.grossSalesCents += subtotalCents;
    summary.refundedCents += refundedCents;
    summary.netSalesCents += netCents;
    summary.commissionCents += commissionCents;
    summary.deliveryFeesCents += toCents(order.deliveryFee);
    if (rate === null || !Number.isFinite(rate)) {
      summary.ordersWithoutCommissionRule++;
      summary.salesWithoutCommissionRuleCents += netCents;
    }

    const completedAt = order.deliveredAt ?? order.createdAt;
    addToBucket(daily, dayKey(completedAt), order.itemQuantity, netCents, commissionCents);
    addToBucket(weekly, weekKey(completedAt), order.itemQuantity, netCents, commissionCents);
    addToBucket(monthly, monthKey(completedAt), order.itemQuantity, netCents, commissionCents);
  }

  summary.estimatedEarningsCents = summary.netSalesCents - summary.commissionCents;
  summary.daily = sortedBuckets(daily);
  summary.weekly = sortedBuckets(weekly);
  summary.monthly = sortedBuckets(monthly);
  return summary;
}

function csvCell(value: string | number) {
  const text = String(value);
  // Neutralise spreadsheet formulas and quote every cell.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

const money = (cents: number) => (cents / 100).toFixed(2);

export function vendorFinanceCsv(buckets: readonly FinanceBucket[], periodLabel: string): string {
  const header = [periodLabel, "Sifariş sayı", "Satılan ədəd", "Xalis satış (AZN)", "Platforma komissiyası (AZN)", "Təxmini qazanc (AZN)"];
  const rows = buckets.map((bucket) => [bucket.key, bucket.orders, bucket.quantity, money(bucket.netSalesCents), money(bucket.commissionCents), money(bucket.estimatedEarningsCents)]);
  return "﻿" + [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
