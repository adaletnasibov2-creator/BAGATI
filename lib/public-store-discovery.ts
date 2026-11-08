import { Prisma, type PrismaClient } from "@prisma/client";
import { isPublicStoreEligible, type PublicStoreCandidate } from "@/lib/public-store-eligibility";
import { publicStoreListingCandidateWhere } from "@/lib/store-visibility";

export const PUBLIC_STORE_DISCOVERY_PAGE_SIZE = 60;
export const PUBLIC_STORE_DISCOVERY_PAGE_SIZE_LIMIT = 50;
/** Fetch at most 100 lightweight candidates per query; tests may inject a smaller batch. */
export const PUBLIC_STORE_DISCOVERY_BATCH_SIZE = 100;
/** Cursor requests inspect at most this many candidates, plus one continuation probe. */
export const PUBLIC_STORE_DISCOVERY_MAX_SCAN_ROWS = 500;

const candidateSelect = {
  id: true,
  name: true,
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
} satisfies Prisma.StoreSelect;

const storeSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  logoUrl: true,
  latitude: true,
  longitude: true,
  city: { select: { name: true, slug: true } },
} satisfies Prisma.StoreSelect;

type CandidateRecord = Prisma.StoreGetPayload<{ select: typeof candidateSelect }>;
type StoreRecord = Prisma.StoreGetPayload<{ select: typeof storeSelect }>;
type CandidateCursor = { name: string; id: string };
type DiscoveryCursor = CandidateCursor & { direction: "after" | "before"; recovery?: boolean };

export function encodeStoreDiscoveryCursor(cursor: CandidateCursor, direction: DiscoveryCursor["direction"], recovery = false): string {
  return Buffer.from(JSON.stringify({ n: cursor.name, i: cursor.id, d: direction, r: recovery })).toString("base64url");
}

export function decodeStoreDiscoveryCursor(value: string): DiscoveryCursor | null {
  if (!value || value.length > 1024) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof parsed.n !== "string" || parsed.n.length > 500 || typeof parsed.i !== "string"
      || (parsed.r !== undefined && typeof parsed.r !== "boolean")
      || parsed.i.length < 1 || parsed.i.length > 128 || (parsed.d !== "after" && parsed.d !== "before")) return null;
    return { name: parsed.n, id: parsed.i, direction: parsed.d, recovery: parsed.r === true };
  } catch { return null; }
}

export type PublicStoreDiscoveryCandidate = CandidateRecord & PublicStoreCandidate;
export type PublicStoreDiscoveryRecord = StoreRecord;

export type PublicStoreDiscoveryQuery = {
  where: Prisma.StoreWhereInput;
  orderBy: [{ name: "asc" | "desc" }, { id: "asc" | "desc" }];
  take: number;
};

export type PublicStoreDiscoveryClient = {
  findCandidates(query: PublicStoreDiscoveryQuery): Promise<PublicStoreDiscoveryCandidate[]>;
  findStoresByIds(ids: string[]): Promise<PublicStoreDiscoveryRecord[]>;
};

export function createPrismaPublicStoreDiscoveryClient(
  client: Pick<PrismaClient, "store"> | Pick<Prisma.TransactionClient, "store">,
): PublicStoreDiscoveryClient {
  return {
    findCandidates: ({ where, orderBy, take }) => client.store.findMany({
      where,
      select: candidateSelect,
      orderBy,
      take,
    }),
    findStoresByIds: (ids) => client.store.findMany({
      where: { id: { in: ids } },
      select: storeSelect,
    }),
  };
}

function afterCursor(cursor: CandidateCursor): Prisma.StoreWhereInput {
  return {
    OR: [
      { name: { gt: cursor.name } },
      { name: cursor.name, id: { gt: cursor.id } },
    ],
  };
}

function beforeCursor(cursor: CandidateCursor): Prisma.StoreWhereInput {
  return { OR: [{ name: { lt: cursor.name } }, { name: cursor.name, id: { lt: cursor.id } }] };
}

/** Cursor-paginated discovery that keeps candidate queries and returned pages bounded. */
export async function findPublicStoreDiscoveryCursorPage(
  client: PublicStoreDiscoveryClient,
  filters: { citySlug?: string | null; query?: string | null } = {},
  options: { now?: Date; batchSize?: number; pageSize?: number; cursor?: string; maxScanRows?: number } = {},
): Promise<{ items: PublicStoreDiscoveryRecord[]; pageSize: number; hasNext: boolean; hasPrevious: boolean; nextCursor: string | null; previousCursor: string | null }> {
  const batchSize = options.batchSize ?? PUBLIC_STORE_DISCOVERY_BATCH_SIZE;
  const pageSize = options.pageSize ?? 24;
  const maxScanRows = options.maxScanRows ?? PUBLIC_STORE_DISCOVERY_MAX_SCAN_ROWS;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new RangeError("PUBLIC_STORE_DISCOVERY_BATCH_SIZE_OUT_OF_RANGE");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > PUBLIC_STORE_DISCOVERY_PAGE_SIZE_LIMIT) throw new RangeError("PUBLIC_STORE_DISCOVERY_PAGE_SIZE_OUT_OF_RANGE");
  if (!Number.isInteger(maxScanRows) || maxScanRows < 1 || maxScanRows > 5000) throw new RangeError("PUBLIC_STORE_DISCOVERY_SCAN_LIMIT_OUT_OF_RANGE");
  const decoded = options.cursor === undefined ? null : decodeStoreDiscoveryCursor(options.cursor);
  if (options.cursor !== undefined && !decoded) throw new RangeError("PUBLIC_STORE_DISCOVERY_CURSOR_INVALID");
  const direction = decoded?.direction ?? "after";
  const now = options.now ?? new Date();
  const baseWhere = publicStoreListingCandidateWhere(filters, now);
  const ids: string[] = [];
  const cursors: CandidateCursor[] = [];
  let lastScanned: CandidateCursor | undefined;
  let hasMore = false;
  let scanContinuation = false;
  let scanned = 0;

  while (true) {
    const take = Math.min(batchSize, maxScanRows - scanned);
    if (take < 1) break;
    const pageWhere = decoded
      ? { AND: [baseWhere, direction === "after" ? afterCursor(decoded) : beforeCursor(decoded)] }
      : baseWhere;
    const where = lastScanned
      ? { AND: [pageWhere, direction === "after" ? afterCursor(lastScanned) : beforeCursor(lastScanned)] }
      : pageWhere;
    const candidates = await client.findCandidates({
      where,
      orderBy: direction === "after" ? [{ name: "asc" }, { id: "asc" }] : [{ name: "desc" }, { id: "desc" }],
      take,
    });
    if (!candidates.length) break;
    for (const candidate of candidates) {
      lastScanned = { name: candidate.name, id: candidate.id };
      scanned += 1;
      if (!isPublicStoreEligible(candidate, now)) continue;
      if (ids.length >= pageSize) { hasMore = true; break; }
      ids.push(candidate.id);
      cursors.push(lastScanned);
    }
    if (hasMore) break;
    if (scanned >= maxScanRows) {
      const probeWhere = lastScanned
        ? { AND: [baseWhere, direction === "after" ? afterCursor(lastScanned) : beforeCursor(lastScanned)] }
        : pageWhere;
      const probe = await client.findCandidates({
        where: probeWhere,
        orderBy: direction === "after" ? [{ name: "asc" }, { id: "asc" }] : [{ name: "desc" }, { id: "desc" }],
        take: 1,
      });
      if (probe.length) { hasMore = true; scanContinuation = true; }
      break;
    }
    if (candidates.length < take) break;
  }

  if (direction === "before") { ids.reverse(); cursors.reverse(); }
  if (!ids.length) {
    const continuation = hasMore && lastScanned ? encodeStoreDiscoveryCursor(lastScanned, direction, decoded?.recovery) : null;
    const recovery = decoded && !decoded.recovery
      ? encodeStoreDiscoveryCursor(decoded, direction === "after" ? "before" : "after", true)
      : null;
    const continueInRequestedDirection = continuation !== null;
    return {
      items: [], pageSize,
      hasNext: direction === "after" ? continueInRequestedDirection : !continueInRequestedDirection && Boolean(recovery),
      hasPrevious: direction === "before" ? continueInRequestedDirection : !continueInRequestedDirection && Boolean(recovery),
      nextCursor: direction === "after" ? continuation : !continueInRequestedDirection ? recovery : null,
      previousCursor: direction === "before" ? continuation : !continueInRequestedDirection ? recovery : null,
    };
  }
  const rows = await client.findStoresByIds(ids);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const items = ids.flatMap((id) => { const row = byId.get(id); return row ? [row] : []; });
  if (items.length !== ids.length) throw new Error("PUBLIC_STORE_DISCOVERY_RESULT_CHANGED");
  const hasNext = direction === "after" ? hasMore : Boolean(decoded);
  const hasPrevious = direction === "before" ? hasMore : Boolean(decoded);
  const nextBoundary = direction === "after" && scanContinuation ? lastScanned! : cursors.at(-1)!;
  const previousBoundary = direction === "before" && scanContinuation ? lastScanned! : cursors[0];
  return {
    items,
    pageSize,
    hasNext,
    hasPrevious,
    nextCursor: hasNext ? encodeStoreDiscoveryCursor(nextBoundary, "after", decoded?.recovery) : null,
    previousCursor: hasPrevious ? encodeStoreDiscoveryCursor(previousBoundary, "before", decoded?.recovery) : null,
  };
}

export function publicStoreDiscoveryCursorResponse(page: {
  items: PublicStoreDiscoveryRecord[];
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

/** @deprecated Legacy complete collector; public pages should use cursor discovery. */
export async function findPublicStoreDiscoveryPage(
  client: PublicStoreDiscoveryClient,
  filters: { citySlug?: string | null; query?: string | null } = {},
  options: { now?: Date; batchSize?: number } = {},
): Promise<PublicStoreDiscoveryRecord[]> {
  const batchSize = options.batchSize ?? PUBLIC_STORE_DISCOVERY_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new RangeError("PUBLIC_STORE_DISCOVERY_BATCH_SIZE_OUT_OF_RANGE");
  }

  const now = options.now ?? new Date();
  const baseWhere = publicStoreListingCandidateWhere(filters, now);
  const selectedIds: string[] = [];
  let cursor: CandidateCursor | undefined;

  // There is no total candidate cap: a cap could misrepresent an incomplete scan
  // as an exhausted result page when trim-aware eligibility is sparse. Each query
  // remains bounded, but a sparse candidate set can require scanning many batches.
  while (selectedIds.length < PUBLIC_STORE_DISCOVERY_PAGE_SIZE) {
    const candidates = await client.findCandidates({
      where: cursor ? { AND: [baseWhere, afterCursor(cursor)] } : baseWhere,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: batchSize,
    });
    if (candidates.length === 0) break;

    for (const candidate of candidates) {
      cursor = { name: candidate.name, id: candidate.id };
      if (!isPublicStoreEligible(candidate, now)) continue;
      selectedIds.push(candidate.id);
      if (selectedIds.length === PUBLIC_STORE_DISCOVERY_PAGE_SIZE) break;
    }

    if (candidates.length < batchSize) break;
  }

  if (selectedIds.length === 0) return [];

  const stores = await client.findStoresByIds(selectedIds);
  const storesById = new Map(stores.map((store) => [store.id, store]));
  const orderedStores = selectedIds.flatMap((id) => {
    const store = storesById.get(id);
    return store ? [store] : [];
  });
  if (orderedStores.length !== selectedIds.length) {
    throw new Error("PUBLIC_STORE_DISCOVERY_RESULT_CHANGED");
  }
  return orderedStores;
}
