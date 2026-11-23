import { Prisma } from "@prisma/client";
import { toCents } from "@/lib/vendor-finance";
import {
  categoryTotals, normalizeCityRows, previousRange, summarizeReceivedOrders, summarizeStatusGroups, topByValue,
  TOP_GROUPS_LIMIT, TOP_PRODUCTS_LIMIT, type NamedTotal, type ProductTotal, type ReceivedOrdersSummary,
} from "@/lib/vendor-sales-analytics";

/** Existing wording (the store sales report): products without a category. */
export const UNCATEGORIZED_LABEL = "Kateqoriyasız";

/**
 * The part of the Prisma client the analytics need (a stand-in in unit tests). Every query below is scoped to ONE
 * store (`storeId`) and the bounded date range; nothing is written.
 */
export type SalesAnalyticsDb = {
  storeOrder: {
    findMany(args: { where: Record<string, unknown>; select: Record<string, true> }): Promise<{ status: string; subtotal: unknown; createdAt: Date }[]>;
    groupBy(args: { by: ["status"]; where: Record<string, unknown>; _count: { _all: true }; _sum: { subtotal: true } }): Promise<{ status: string; _count: { _all: number }; _sum: { subtotal: unknown } }[]>;
  };
  orderItem: {
    groupBy(args: { by: ["productId"]; where: Record<string, unknown>; _sum: { quantity: true; lineTotal: true } }): Promise<{ productId: string; _sum: { quantity: number | null; lineTotal: unknown } }[]>;
  };
  product: {
    findMany(args: { where: Record<string, unknown>; select: Record<string, unknown> }): Promise<{ id: string; name: string; category?: { name: string } | null }[]>;
  };
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
};

export type VendorSalesAnalytics = {
  received: ReceivedOrdersSummary;
  topProducts: NamedTotal[];
  /** PRO (ADVANCED_ANALYTICS) only; null otherwise. */
  previous: { received: number; orderValueCents: number } | null;
  categories: NamedTotal[] | null;
  cities: { city: string | null; orders: number }[] | null;
};

/**
 * Order analytics for one store and one bounded range (the caller checks analyticsRangeAllowed). Queries:
 * 1. store orders created in the range: status, subtotal, createdAt only (time series must use the same day keys as
 *    the delivered-sales table, so they are bucketed in lib/vendor-sales-analytics.ts, not by the database clock);
 * 2. order items of those orders (not cancelled), grouped by product in SQL;
 * 3. names (and, for PRO, categories) of the ordered products, one query, store-scoped;
 * PRO only: 4. previous equal period grouped by status in SQL; 5. not-cancelled orders grouped by city in SQL.
 */
export async function loadVendorSalesAnalytics(db: SalesAnalyticsDb, input: { storeId: string; start: Date; end: Date; advanced: boolean }): Promise<VendorSalesAnalytics> {
  const { storeId, start, end, advanced } = input;
  const range = { gte: start, lte: end };
  const [rows, itemGroups] = await Promise.all([
    db.storeOrder.findMany({ where: { storeId, createdAt: range }, select: { status: true, subtotal: true, createdAt: true } }),
    db.orderItem.groupBy({ by: ["productId"], where: { storeOrder: { storeId, createdAt: range, status: { not: "CANCELLED" } } }, _sum: { quantity: true, lineTotal: true } }),
  ]);
  const received = summarizeReceivedOrders(rows.map((row) => ({ status: row.status, subtotal: row.subtotal as string, createdAt: row.createdAt })));
  const productTotals: ProductTotal[] = itemGroups.map((group) => ({
    productId: group.productId,
    quantity: group._sum.quantity ?? 0,
    valueCents: group._sum.lineTotal === null || group._sum.lineTotal === undefined ? 0 : toCents(group._sum.lineTotal as string),
  }));
  const ids = productTotals.map((row) => row.productId);
  const products = ids.length
    ? await db.product.findMany({ where: { id: { in: ids }, storeId }, select: advanced ? { id: true, name: true, category: { select: { name: true } } } : { id: true, name: true } })
    : [];
  const nameOf = new Map(products.map((product) => [product.id, product.name]));
  const topProducts = topByValue(productTotals.filter((row) => nameOf.has(row.productId)), TOP_PRODUCTS_LIMIT, (row) => nameOf.get(row.productId) ?? "")
    .map((row) => ({ name: nameOf.get(row.productId) ?? "", quantity: row.quantity, valueCents: row.valueCents }));

  if (!advanced) return { received, topProducts, previous: null, categories: null, cities: null };

  const before = previousRange(start, end);
  const [previousGroups, cityRows] = await Promise.all([
    db.storeOrder.groupBy({ by: ["status"], where: { storeId, createdAt: { gte: before.start, lte: before.end } }, _count: { _all: true }, _sum: { subtotal: true } }),
    // Bounds as UTC timestamps: the DB session runs in Asia/Baku and the columns are timestamp(3) in UTC.
    db.$queryRaw<{ city: string | null; orders: number | bigint }[]>(Prisma.sql`
      SELECT o."addressSnapshot"->>'city' AS city, COUNT(*)::int AS orders
      FROM "StoreOrder" so JOIN "Order" o ON o."id" = so."orderId"
      WHERE so."storeId" = ${storeId}
        AND so."status" <> 'CANCELLED'
        AND so."createdAt" >= (${start.toISOString()}::timestamptz AT TIME ZONE 'UTC')
        AND so."createdAt" <= (${end.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      GROUP BY 1 ORDER BY 2 DESC, 1 ASC
      LIMIT ${TOP_GROUPS_LIMIT}
    `),
  ]);
  const categoryOf = new Map(products.map((product) => [product.id, product.category?.name ?? null]));
  return {
    received,
    topProducts,
    previous: summarizeStatusGroups(previousGroups.map((group) => ({ status: group.status, orders: group._count._all, subtotal: (group._sum.subtotal ?? null) as string | null }))),
    categories: categoryTotals(productTotals, categoryOf, UNCATEGORIZED_LABEL).slice(0, TOP_GROUPS_LIMIT),
    cities: normalizeCityRows(cityRows),
  };
}
