/**
 * Product list, search and the store filter without interactive transactions (SCALE-FIX-1 A3). Before, each list or
 * search view held two pool connections in RepeatableRead transactions for the whole scan; under load other visitors
 * got an error page (P2028, SCALE-1 report section 5). The same catalog and discovery functions now run on plain
 * reads, so results, order, filters and paging come from unchanged code; the real-PostgreSQL comparison with the old
 * transaction is in scripts/scale-fix-1.integration.test.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { findPublicStoreDiscoveryCursorPage, type PublicStoreDiscoveryCandidate, type PublicStoreDiscoveryClient, type PublicStoreDiscoveryRecord } from "../lib/public-store-discovery";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const listPage = read("app/(customer)/products/(list)/page.tsx");
const storeOptions = read("app/api/store-options/route.ts");

test("the product list page (list and search) opens no interactive transaction", () => {
  assert.doesNotMatch(listPage, /\$transaction/);
  assert.doesNotMatch(listPage, /isolationLevel|TransactionIsolationLevel/);
});

test("the product list keeps the same catalog call: filters, catalog search, sort, 48 per page, cursor", () => {
  // CLEANUP-2: + the request's store-eligibility memo as third argument (store rows read once per request).
  assert.match(listPage, /findPublicProductCatalogPage\(\s*createPrismaPublicProductCatalogSelectClient\(prisma, productSelect, storeEligibility\),\s*\{\s*citySlug: params\.city,\s*storeId: params\.store,\s*categorySlug: params\.category,\s*query: searchQuery,\s*searchFields: "catalog",\s*\}, \{ sort, now, limit: 48, paginate: true, allowMissingRecords: true, \.\.\.\(cursor \? \{ cursor \} : \{\}\) \},/);
});

test("the store filter on the list page reads 20 stores with plain reads", () => {
  // CLEANUP-2: + the request's store-eligibility memo (the scan's store rows are remembered for the product scan).
  assert.match(listPage, /findPublicStoreDiscoveryCursorPage\(\s*createPrismaPublicStoreDiscoveryClient\(prisma, storeEligibility\), \{ citySlug: params\.city \}, \{ pageSize: 20, allowMissingRecords: true \},\s*\)/);
});

test("/api/store-options (the store filter's next pages) uses plain reads and stays no-store", () => {
  assert.doesNotMatch(storeOptions, /\$transaction|isolationLevel|TransactionIsolationLevel/);
  assert.match(storeOptions, /findPublicStoreDiscoveryCursorPage\(\s*createPrismaPublicStoreDiscoveryClient\(prisma\),\s*\{ citySlug: city, query \},\s*\{ pageSize: STORE_OPTION_PAGE_SIZE, cursor, allowMissingRecords: true \},\s*\)/);
  assert.match(storeOptions, /"Cache-Control": "no-store"/);
  assert.match(storeOptions, /CURSOR_INVALID[\s\S]*status: 400/);
});

function storeCandidate(id: string): PublicStoreDiscoveryCandidate {
  return {
    id, name: id, status: "ACTIVE", isActive: true, legalInfoApproved: true, adminManaged: true,
    city: { isActive: true },
    vendor: { user: { isActive: true }, sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: "Seller", voen: "1234567890", legalAddress: null },
    subscription: null, complimentaryEntitlements: [],
  } as unknown as PublicStoreDiscoveryCandidate;
}

function discoveryClient(ids: string[], missing: string[] = []): PublicStoreDiscoveryClient {
  return {
    findCandidates: async ({ take }) => ids.slice(0, take).map(storeCandidate),
    findStoresByIds: async (requested) => requested.filter((id) => !missing.includes(id)).map((id) => ({ id, name: id } as PublicStoreDiscoveryRecord)),
  };
}

test("store discovery: by default a store that disappeared after the scan still fails the request", async () => {
  await assert.rejects(findPublicStoreDiscoveryCursorPage(discoveryClient(["a", "b", "c"], ["a"]), {}, { pageSize: 2 }), /PUBLIC_STORE_DISCOVERY_RESULT_CHANGED/);
});

test("store discovery with allowMissingRecords leaves the store out and keeps the cursor", async () => {
  const full = await findPublicStoreDiscoveryCursorPage(discoveryClient(["a", "b", "c"]), {}, { pageSize: 2 });
  const partial = await findPublicStoreDiscoveryCursorPage(discoveryClient(["a", "b", "c"], ["a"]), {}, { pageSize: 2, allowMissingRecords: true });
  assert.deepEqual(full.items.map(({ id }) => id), ["a", "b"]);
  assert.deepEqual(partial.items.map(({ id }) => id), ["b"]);
  assert.equal(partial.hasNext, true);
  assert.equal(partial.nextCursor, full.nextCursor);
});
