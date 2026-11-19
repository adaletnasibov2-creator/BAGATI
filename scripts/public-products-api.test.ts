/**
 * GET /api/products (SCALE-FIX-1 A1): no interactive transaction, offset depth capped at 1000 results, `total` from one
 * bounded SQL COUNT (null when it times out), unchanged response shape, and the catalog's allowMissingRecords option.
 * Before: an exact count of every product in one RepeatableRead transaction, 100% HTTP 500 (P2028) at 50k products.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { findPublicProductCatalogPage, type PublicProductCatalogCandidate, type PublicProductCatalogClient } from "../lib/public-product-catalog";
import {
  countPublicProductsForApi,
  PUBLIC_PRODUCTS_API_COUNT_TIMEOUT_MS,
  PUBLIC_PRODUCTS_API_MAX_RESULTS,
  publicProductsApiCountWhere,
  publicProductsApiPageTooDeep,
} from "../lib/public-products-api";

const route = readFileSync(resolve(process.cwd(), "app/api/products/route.ts"), "utf8");

test("the route reads without an interactive transaction and without an exact total scan", () => {
  assert.doesNotMatch(route, /\$transaction/);
  assert.doesNotMatch(route, /RepeatableRead/);
  assert.doesNotMatch(route, /exactTotal/);
  assert.match(route, /createPrismaPublicProductCatalogClient\(prisma, productInclude\)/);
  assert.match(route, /allowMissingRecords: true/);
  assert.match(route, /countPublicProductsForApi\(prisma, filters, now\)/);
});

test("the response shape stays { items, page, limit, total }; favourites (?ids=) is unchanged", () => {
  assert.match(route, /NextResponse\.json\(\{ items: result\.items, page, limit, total \}\)/);
  assert.match(route, /if \(request\.nextUrl\.searchParams\.has\("ids"\)\)[\s\S]*findPublicProductsByIds\(ids\.ids\)/);
});

test("offset paging is capped at 1000 results; deeper pages get 400 PAGE_TOO_DEEP pointing to the cursor API", () => {
  assert.equal(PUBLIC_PRODUCTS_API_MAX_RESULTS, 1000);
  assert.equal(publicProductsApiPageTooDeep(1, 50), false);
  assert.equal(publicProductsApiPageTooDeep(20, 50), false, "results 951-1000");
  assert.equal(publicProductsApiPageTooDeep(21, 50), true, "results 1001-1050");
  assert.equal(publicProductsApiPageTooDeep(50, 20), false, "results 981-1000");
  assert.equal(publicProductsApiPageTooDeep(51, 20), true);
  assert.equal(publicProductsApiPageTooDeep(1000, 1), false);
  assert.equal(publicProductsApiPageTooDeep(1001, 1), true);
  assert.match(route, /if \(publicProductsApiPageTooDeep\(page, limit\)\)[\s\S]*\/api\/products\/cursor[\s\S]*code: "PAGE_TOO_DEEP"[\s\S]*status: 400/);
});

test("the count where combines the catalog filters with the full public visibility rules", () => {
  const where = publicProductsApiCountWhere({ citySlug: "baki", categorySlug: "geyim", query: "köynək", searchFields: "name" }, new Date("2026-11-19T00:00:00Z"));
  const json = JSON.stringify(where);
  assert.ok(Array.isArray(where.AND) && where.AND.length === 2);
  assert.match(json, /"slug":"baki"/);
  assert.match(json, /"contains":"köynək","mode":"insensitive"/);
  assert.match(json, /"legalInfoApproved":true/);
  assert.match(json, /"status":"ACTIVE"/);
});

test("the count runs in one short batch transaction with a statement timeout", async () => {
  const calls: string[] = [];
  let countArgs: unknown;
  const client = {
    $executeRawUnsafe: (sql: string) => { calls.push(sql); return Promise.resolve(0); },
    product: { count: (args: unknown) => { countArgs = args; return Promise.resolve(42); } },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  };
  const total = await countPublicProductsForApi(client as never, { citySlug: "baki" }, new Date());
  assert.equal(total, 42);
  assert.deepEqual(calls, [`SET LOCAL statement_timeout = ${PUBLIC_PRODUCTS_API_COUNT_TIMEOUT_MS}`]);
  assert.equal(PUBLIC_PRODUCTS_API_COUNT_TIMEOUT_MS, 2000);
  assert.ok(countArgs && typeof countArgs === "object" && "where" in countArgs);
});

test("a count that fails or times out returns null and logs only the error code", async (t) => {
  const warnings: string[] = [];
  t.mock.method(console, "warn", (line: string) => { warnings.push(line); });
  const timeout = new Prisma.PrismaClientKnownRequestError("canceling statement due to statement timeout (internal detail)", { code: "P2010", clientVersion: "test" });
  const client = {
    $executeRawUnsafe: () => Promise.resolve(0),
    product: { count: () => Promise.resolve(0) },
    $transaction: async () => { throw timeout; },
  };
  assert.equal(await countPublicProductsForApi(client as never, {}, new Date()), null);
  assert.deepEqual(warnings, [JSON.stringify({ event: "public_products_api.count_failed", code: "P2010" })]);
  assert.doesNotMatch(warnings[0], /internal detail|statement timeout/);
});

// --- allowMissingRecords (shared catalog function) ---------------------------------------------------------------

function candidate(id: string, day: number): PublicProductCatalogCandidate {
  return {
    id, status: "ACTIVE", name: id, createdAt: new Date(Date.UTC(2026, 0, day)),
    store: {
      id: "store", status: "ACTIVE", isActive: true, legalInfoApproved: true, adminManaged: true,
      city: { isActive: true },
      vendor: { user: { isActive: true }, sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: "Seller", voen: "1234567890", legalAddress: null },
      subscription: null, complimentaryEntitlements: [],
    },
  } as unknown as PublicProductCatalogCandidate;
}

function client(rows: PublicProductCatalogCandidate[], missing: string[] = []): PublicProductCatalogClient<{ id: string }> {
  return {
    findCandidates: async ({ take }) => rows.slice(0, take),
    findRecords: async (ids) => ids.filter((id) => !missing.includes(id)).map((id) => ({ id })),
  };
}

const rows = [candidate("p3", 3), candidate("p2", 2), candidate("p1", 1)];

test("by default a record that disappeared after the scan still fails the page (transactional callers)", async () => {
  await assert.rejects(
    findPublicProductCatalogPage(client(rows, ["p3"]), {}, { sort: "newest", limit: 2, paginate: true }),
    /PUBLIC_PRODUCT_CATALOG_RESULT_CHANGED/,
  );
});

test("with allowMissingRecords the missing product is left out and paging is unchanged", async () => {
  const full = await findPublicProductCatalogPage(client(rows), {}, { sort: "newest", limit: 2, paginate: true });
  const partial = await findPublicProductCatalogPage(client(rows, ["p3"]), {}, { sort: "newest", limit: 2, paginate: true, allowMissingRecords: true });
  assert.deepEqual(full.items.map(({ id }) => id), ["p3", "p2"]);
  assert.deepEqual(partial.items.map(({ id }) => id), ["p2"]);
  assert.equal(partial.hasNext, full.hasNext);
  assert.equal(partial.nextCursor, full.nextCursor, "the next page starts after p2 either way");
});

test("offset mode without exactTotal stops scanning once the page is full", async () => {
  let scans = 0;
  const many = Array.from({ length: 300 }, (_, i) => candidate(`p${300 - i}`, 1 + (300 - i) / 10));
  const counting: PublicProductCatalogClient<{ id: string }> = {
    findCandidates: async ({ take }) => { scans += 1; return many.slice((scans - 1) * take, scans * take); },
    findRecords: async (ids) => ids.map((id) => ({ id })),
  };
  const page = await findPublicProductCatalogPage(counting, {}, { sort: "newest", offset: 0, limit: 24, allowMissingRecords: true });
  assert.equal(page.items.length, 24);
  assert.equal(page.total, null);
  assert.equal(scans, 1, "one batch of 100 is enough for the first page; the old exact total scanned all 300");
});
