import { Prisma, type PrismaClient } from "@prisma/client";

export const CUSTOMER_ORDER_PAGE_SIZE = 20;
export const CUSTOMER_ORDER_PAGE_SIZE_MAX = 50;

type OrderCursor = { id: string; createdAt: Date; direction: "after" | "before"; recovery?: boolean };

export function encodeCustomerOrderCursor(cursor: Omit<OrderCursor, "direction" | "recovery">, direction: OrderCursor["direction"], recovery = false): string {
  return Buffer.from(JSON.stringify({ i: cursor.id, t: cursor.createdAt.toISOString(), d: direction, r: recovery })).toString("base64url");
}

export function decodeCustomerOrderCursor(value: string): OrderCursor | null {
  if (!value || value.length > 512) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof parsed.i !== "string" || parsed.i.length < 1 || parsed.i.length > 128
      || (parsed.r !== undefined && typeof parsed.r !== "boolean")
      || typeof parsed.t !== "string" || (parsed.d !== "after" && parsed.d !== "before")) return null;
    const createdAt = new Date(parsed.t);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== parsed.t) return null;
    return { id: parsed.i, createdAt, direction: parsed.d, recovery: parsed.r === true };
  } catch { return null; }
}

export function parseCustomerOrderPageSize(value: string | null): number | null {
  if (value === null) return CUSTOMER_ORDER_PAGE_SIZE;
  if (!/^[1-9]\d{0,2}$/.test(value)) return null;
  const size = Number(value);
  return size <= CUSTOMER_ORDER_PAGE_SIZE_MAX ? size : null;
}

type OrderListClient = Pick<PrismaClient, "order">;

export async function listCustomerOrderPage(
  client: OrderListClient,
  userId: string,
  options: { cursor?: string; pageSize?: number } = {},
) {
  const pageSize = options.pageSize ?? CUSTOMER_ORDER_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > CUSTOMER_ORDER_PAGE_SIZE_MAX) throw new RangeError("CUSTOMER_ORDER_PAGE_SIZE_INVALID");
  const cursor = options.cursor === undefined ? null : decodeCustomerOrderCursor(options.cursor);
  if (options.cursor !== undefined && !cursor) throw new RangeError("CUSTOMER_ORDER_CURSOR_INVALID");

  const cursorFilter: Prisma.OrderWhereInput | undefined = cursor
    ? cursor.direction === "after"
      ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }
      : { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] }
    : undefined;
  const ascending = cursor?.direction === "before";
  const found = await client.order.findMany({
    where: { userId, ...(cursorFilter ? { AND: [cursorFilter] } : {}) },
    select: {
      id: true,
      status: true,
      total: true,
      createdAt: true,
      storeOrders: { select: { id: true, store: { select: { name: true } }, _count: { select: { items: true } } } },
      payments: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { status: true },
      },
    },
    orderBy: [{ createdAt: ascending ? "asc" : "desc" }, { id: ascending ? "asc" : "desc" }],
    take: pageSize + 1,
  });
  const hasMore = found.length > pageSize;
  const items = (hasMore ? found.slice(0, pageSize) : found) as Array<{
    id: string; createdAt: Date; status: string; total: Prisma.Decimal;
    storeOrders: { id: string; store: { name: string }; _count: { items: number } }[];
    payments: { status: string }[];
  }>;
  if (ascending) items.reverse();
  if (!items.length) return {
    items,
    pageSize,
    // Keep a reverse path to the page that issued this cursor. The cursor is
    // a tuple boundary, so recovery still works if its order was deleted.
    hasNext: cursor?.direction === "before" && !cursor.recovery,
    hasPrevious: cursor?.direction === "after" && !cursor.recovery,
    nextCursor: cursor?.direction === "before" && !cursor.recovery ? encodeCustomerOrderCursor(cursor, "after", true) : null,
    previousCursor: cursor?.direction === "after" && !cursor.recovery ? encodeCustomerOrderCursor(cursor, "before", true) : null,
  };
  const hasNext = cursor ? (ascending ? items.length > 0 : hasMore) : hasMore;
  const hasPrevious = cursor ? (ascending ? hasMore : items.length > 0) : false;
  const boundary = (item: typeof items[number]) => ({ id: item.id, createdAt: item.createdAt });
  return {
    items,
    pageSize,
    hasNext,
    hasPrevious,
    nextCursor: hasNext && items.length ? encodeCustomerOrderCursor(boundary(items[items.length - 1]), "after", cursor?.recovery) : null,
    previousCursor: hasPrevious && items.length ? encodeCustomerOrderCursor(boundary(items[0]), "before", cursor?.recovery) : null,
  };
}
