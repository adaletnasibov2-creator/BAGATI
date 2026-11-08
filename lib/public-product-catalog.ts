import { Prisma, type PrismaClient } from "@prisma/client";
import { isPublicStoreEligible, type PublicStoreCandidate } from "@/lib/public-store-eligibility";
import { publicStoreEligibilityBaseWhere } from "@/lib/seller-legal-policy";
import { productCatalogOrderBy, type ProductCatalogSort } from "@/lib/catalog-sort";

export const PUBLIC_PRODUCT_CATALOG_BATCH_SIZE = 100;
export const PUBLIC_PRODUCT_CATALOG_MAX_PAGE_SIZE = 50;
/** Candidate rows scanned by one cursor request (plus at most one probe row). */
export const PUBLIC_PRODUCT_CATALOG_MAX_SCAN_ROWS = 500;

const candidateSelect = {
  id: true,
  status: true,
  name: true,
  createdAt: true,
  store: {
    select: {
      id: true,
      status: true,
      isActive: true,
      legalInfoApproved: true,
      adminManaged: true,
      city: { select: { isActive: true } },
      vendor: {
        select: {
          sellerType: true,
          legalName: true,
          voen: true,
          legalAddress: true,
          user: { select: { isActive: true } },
        },
      },
      subscription: {
        select: {
          status: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          plan: { select: { isActive: true, slug: true } },
        },
      },
    },
  },
} satisfies Prisma.ProductSelect;

type CandidateRecord = Prisma.ProductGetPayload<{ select: typeof candidateSelect }>;
export type PublicProductCatalogCandidate = CandidateRecord & { store: PublicStoreCandidate };
export type ProductCursor =
  | { sort: "name"; name: string; id: string }
  | { sort: "newest"; createdAt: Date; id: string };

type Direction = "after" | "before";

export function encodeProductCatalogCursor(cursor: ProductCursor, direction: Direction, recovery = false): string {
  const value = cursor.sort === "name"
    ? { s: cursor.sort, d: direction, n: cursor.name, i: cursor.id, r: recovery }
    : { s: cursor.sort, d: direction, t: cursor.createdAt.toISOString(), i: cursor.id, r: recovery };
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function decodeProductCatalogCursor(value: string): { cursor: ProductCursor; direction: Direction; recovery: boolean } | null {
  if (!value || value.length > 1024) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof parsed.i !== "string" || parsed.i.length < 1 || parsed.i.length > 128
      || (parsed.r !== undefined && typeof parsed.r !== "boolean")
      || (parsed.d !== "after" && parsed.d !== "before")) return null;
    if (parsed.s === "name" && typeof parsed.n === "string" && parsed.n.length <= 500) {
      return { cursor: { sort: "name", name: parsed.n, id: parsed.i }, direction: parsed.d, recovery: parsed.r === true };
    }
    if (parsed.s === "newest" && typeof parsed.t === "string") {
      const createdAt = new Date(parsed.t);
      if (Number.isFinite(createdAt.getTime()) && createdAt.toISOString() === parsed.t) {
        return { cursor: { sort: "newest", createdAt, id: parsed.i }, direction: parsed.d, recovery: parsed.r === true };
      }
    }
  } catch { /* malformed public cursor */ }
  return null;
}

export type PublicProductCatalogFilters = {
  citySlug?: string | null;
  storeId?: string | null;
  categorySlug?: string | null;
  query?: string | null;
  searchFields?: "name" | "catalog";
};

export type PublicProductCatalogQuery = {
  where: Prisma.ProductWhereInput;
  orderBy: [{ name: "asc" | "desc" }, { id: "asc" | "desc" }] | [{ createdAt: "asc" | "desc" }, { id: "asc" | "desc" }];
  take: number;
};

export type PublicProductCatalogClient<T extends { id: string }> = {
  findCandidates(query: PublicProductCatalogQuery): Promise<PublicProductCatalogCandidate[]>;
  findRecords(ids: string[]): Promise<T[]>;
};

export function publicProductCatalogCandidateWhere(
  filters: PublicProductCatalogFilters = {},
  now = new Date(),
): Prisma.ProductWhereInput {
  const storeFilters: Prisma.StoreWhereInput[] = [publicStoreEligibilityBaseWhere(now)];
  if (filters.citySlug) storeFilters.push({ city: { isActive: true, slug: filters.citySlug } });
  if (filters.storeId) storeFilters.push({ id: filters.storeId });

  const where: Prisma.ProductWhereInput = {
    status: "ACTIVE",
    store: { is: { AND: storeFilters } },
  };
  if (filters.categorySlug) {
    where.category = { slug: filters.categorySlug, isActive: true };
  }
  if (filters.query) {
    const textFields = filters.searchFields === "catalog"
      ? [
        { name: { contains: filters.query, mode: "insensitive" as const } },
        { description: { contains: filters.query, mode: "insensitive" as const } },
        { sku: { contains: filters.query, mode: "insensitive" as const } },
      ]
      : [{ name: { contains: filters.query, mode: "insensitive" as const } }];
    where.OR = textFields;
  }
  return where;
}

export function publicProductCatalogCursorResponse<T>(page: {
  items: T[];
  pageSize: number;
  hasNext: boolean;
  hasPrevious: boolean;
  nextCursor: string | null;
  previousCursor: string | null;
}) {
  return {
    items: page.items,
    pageSize: page.pageSize,
    hasNext: page.hasNext,
    hasPrevious: page.hasPrevious,
    nextCursor: page.nextCursor,
    previousCursor: page.previousCursor,
  };
}

export function createPrismaPublicProductCatalogClient<I extends Prisma.ProductInclude>(
  client: Pick<PrismaClient, "product"> | Pick<Prisma.TransactionClient, "product">,
  include: I,
): PublicProductCatalogClient<Prisma.ProductGetPayload<{ include: I }>> {
  return {
    findCandidates: ({ where, orderBy, take }) => client.product.findMany({
      where,
      select: candidateSelect,
      orderBy,
      take,
    }),
    findRecords: (ids) => client.product.findMany({
      where: { id: { in: ids } },
      include,
    }),
  };
}

function orderByFor(sort: ProductCatalogSort, direction: Direction = "after"): PublicProductCatalogQuery["orderBy"] {
  const order = productCatalogOrderBy(sort);
  if (direction === "after") return order;
  return sort === "name" ? [{ name: "desc" }, { id: "desc" }] : [{ createdAt: "asc" }, { id: "asc" }];
}

function cursorWhere(cursor: ProductCursor, direction: Direction = "after"): Prisma.ProductWhereInput {
  const after = direction === "after";
  if (cursor.sort === "name") {
    return {
      OR: [
        { name: { [after ? "gt" : "lt"]: cursor.name } },
        { name: cursor.name, id: { [after ? "gt" : "lt"]: cursor.id } },
      ],
    };
  }
  return {
    OR: [
      { createdAt: { [after ? "lt" : "gt"]: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { [after ? "lt" : "gt"]: cursor.id } },
    ],
  };
}

function cursorFor(candidate: PublicProductCatalogCandidate, sort: ProductCatalogSort): ProductCursor {
  return sort === "name"
    ? { sort, name: candidate.name, id: candidate.id }
    : { sort, createdAt: candidate.createdAt, id: candidate.id };
}

export async function findPublicProductCatalogPage<T extends { id: string }>(
  client: PublicProductCatalogClient<T>,
  filters: PublicProductCatalogFilters,
  options: {
    sort: ProductCatalogSort;
    now?: Date;
    offset?: number;
    cursor?: string;
    paginate?: boolean;
    limit: number;
    exactTotal?: boolean;
    batchSize?: number;
    maxScanRows?: number;
  },
): Promise<{ items: T[]; pageSize: number; total: number | null; hasNext: boolean; hasPrevious: boolean; nextCursor: string | null; previousCursor: string | null }> {
  const batchSize = options.batchSize ?? PUBLIC_PRODUCT_CATALOG_BATCH_SIZE;
  const maxScanRows = options.maxScanRows ?? PUBLIC_PRODUCT_CATALOG_MAX_SCAN_ROWS;
  const offset = options.offset ?? 0;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new RangeError("PUBLIC_PRODUCT_CATALOG_BATCH_SIZE_OUT_OF_RANGE");
  }
  if (!Number.isInteger(maxScanRows) || maxScanRows < 1 || maxScanRows > 5000) {
    throw new RangeError("PUBLIC_PRODUCT_CATALOG_SCAN_LIMIT_OUT_OF_RANGE");
  }
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(options.limit) || options.limit < 1
    || options.limit > PUBLIC_PRODUCT_CATALOG_MAX_PAGE_SIZE
    || !Number.isSafeInteger(offset + options.limit)) {
    throw new RangeError("PUBLIC_PRODUCT_CATALOG_PAGINATION_OUT_OF_RANGE");
  }

  const parsedCursor = options.cursor === undefined ? null : decodeProductCatalogCursor(options.cursor);
  if (options.cursor !== undefined && (!parsedCursor || parsedCursor.cursor.sort !== options.sort)) {
    throw new RangeError("PUBLIC_PRODUCT_CATALOG_CURSOR_INVALID");
  }
  const cursorPaging = options.paginate === true || parsedCursor !== null;
  if (cursorPaging && options.exactTotal) throw new RangeError("PUBLIC_PRODUCT_CATALOG_CURSOR_EXACT_TOTAL_UNSUPPORTED");
  if (cursorPaging && options.offset) throw new RangeError("PUBLIC_PRODUCT_CATALOG_CURSOR_OFFSET_CONFLICT");
  const direction = parsedCursor?.direction ?? "after";
  const now = options.now ?? new Date();
  const baseWhere = publicProductCatalogCandidateWhere(filters, now);
  const orderBy = orderByFor(options.sort, direction);
  const selectedIds: string[] = [];
  const selectedCursors: ProductCursor[] = [];
  let eligibleCount = 0;
  let cursor: ProductCursor | undefined;
  let hasMore = false;
  let scanned = 0;
  let scanContinuation = false;
  const pageEnd = offset + options.limit;

  // Cursor pages have a strict candidate scan ceiling plus one continuation
  // probe. Legacy offset/exact-total callers intentionally retain their old
  // semantics and may scan the complete candidate set.
  while (true) {
    const take = cursorPaging ? Math.min(batchSize, maxScanRows - scanned) : batchSize;
    if (take < 1) break;
    const candidates = await client.findCandidates({
      where: { AND: [baseWhere, ...(cursor ? [cursorWhere(cursor, direction)] : []), ...(parsedCursor && !cursor ? [cursorWhere(parsedCursor.cursor, direction)] : [])] },
      orderBy,
      take,
    });
    if (candidates.length === 0) break;

    for (const candidate of candidates) {
      cursor = cursorFor(candidate, options.sort);
      scanned += 1;
      if (candidate.status !== "ACTIVE" || !isPublicStoreEligible(candidate.store, now)) continue;

      if (cursorPaging) {
        if (selectedIds.length >= options.limit) { hasMore = true; break; }
        selectedIds.push(candidate.id);
        selectedCursors.push(cursorFor(candidate, options.sort));
      } else if (eligibleCount >= offset && eligibleCount < pageEnd) {
        selectedIds.push(candidate.id);
        selectedCursors.push(cursorFor(candidate, options.sort));
      }
      eligibleCount += 1;
      if (!options.exactTotal && !cursorPaging && selectedIds.length >= options.limit) break;
    }

    if (cursorPaging && hasMore) break;
    if (cursorPaging && scanned >= maxScanRows) {
      // A one-row probe distinguishes exhaustion from a bounded continuation.
      // The probe is not consumed; the next page starts after lastScanned.
      const probe = await client.findCandidates({
        where: { AND: [baseWhere, cursor ? cursorWhere(cursor, direction) : cursorWhere(parsedCursor!.cursor, direction)] },
        orderBy,
        take: 1,
      });
      if (probe.length) { hasMore = true; scanContinuation = true; }
      break;
    }
    if (!options.exactTotal && !cursorPaging && selectedIds.length >= options.limit) break;
    if (candidates.length < take) break;
  }

  if (selectedIds.length === 0) {
    const continuation = hasMore && cursor ? encodeProductCatalogCursor(cursor, direction, parsedCursor?.recovery) : null;
    const recovery = parsedCursor && !parsedCursor.recovery
      ? encodeProductCatalogCursor(parsedCursor.cursor, direction === "after" ? "before" : "after", true)
      : null;
    const continueInRequestedDirection = continuation !== null;
    return {
      items: [],
      pageSize: options.limit,
      total: options.exactTotal ? eligibleCount : null,
      hasNext: direction === "after" ? continueInRequestedDirection : !continueInRequestedDirection && Boolean(recovery),
      hasPrevious: direction === "before" ? continueInRequestedDirection : !continueInRequestedDirection && Boolean(recovery),
      nextCursor: direction === "after" ? continuation : !continueInRequestedDirection ? recovery : null,
      previousCursor: direction === "before" ? continuation : !continueInRequestedDirection ? recovery : null,
    };
  }

  if (parsedCursor?.direction === "before") {
    selectedIds.reverse();
    selectedCursors.reverse();
  }
  const records = await client.findRecords(selectedIds);
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const items = selectedIds.flatMap((id) => {
    const item = recordsById.get(id);
    return item === undefined ? [] : [item];
  });
  if (items.length !== selectedIds.length) {
    throw new Error("PUBLIC_PRODUCT_CATALOG_RESULT_CHANGED");
  }
  const isCursorPage = cursorPaging;
  const hasNext = isCursorPage ? (direction === "after" ? hasMore : Boolean(parsedCursor)) : false;
  const hasPrevious = isCursorPage ? (direction === "before" ? hasMore : Boolean(parsedCursor)) : false;
  const nextBoundary = direction === "after" && scanContinuation ? cursorForCandidateCursor(cursor, options.sort) : selectedCursors.at(-1)!;
  const previousBoundary = direction === "before" && scanContinuation ? cursorForCandidateCursor(cursor, options.sort) : selectedCursors[0];
  return {
    items,
    pageSize: options.limit,
    total: options.exactTotal ? eligibleCount : null,
    hasNext,
    hasPrevious,
    nextCursor: hasNext && selectedCursors.length ? encodeProductCatalogCursor(nextBoundary, "after", parsedCursor?.recovery) : null,
    previousCursor: hasPrevious && selectedCursors.length ? encodeProductCatalogCursor(direction === "before" && scanContinuation ? previousBoundary : selectedCursors[0], "before", parsedCursor?.recovery) : null,
  };
}

function cursorForCandidateCursor(cursor: ProductCursor | undefined, sort: ProductCatalogSort): ProductCursor {
  if (!cursor || cursor.sort !== sort) throw new Error("PUBLIC_PRODUCT_CATALOG_CURSOR_BOUNDARY_MISSING");
  return cursor;
}
