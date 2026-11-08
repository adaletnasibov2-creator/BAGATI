import assert from "node:assert/strict";
import test from "node:test";
import type { ProductCatalogSort } from "../lib/catalog-sort";
import {
  decodeProductCatalogCursor,
  encodeProductCatalogCursor,
  findPublicProductCatalogPage,
  publicProductCatalogCursorResponse,
  publicProductCatalogCandidateWhere,
  type PublicProductCatalogCandidate,
  type PublicProductCatalogClient,
  type PublicProductCatalogQuery,
} from "../lib/public-product-catalog";

function storeCandidate(overrides: Partial<PublicProductCatalogCandidate["store"]> = {}) {
  return {
    id: "store",
    status: "ACTIVE",
    isActive: true,
    legalInfoApproved: true,
    adminManaged: false,
    city: { isActive: true },
    vendor: {
      user: { isActive: true },
      sellerType: "INDIVIDUAL_ENTREPRENEUR",
      legalName: "Seller",
      voen: "1234567890",
      legalAddress: null,
    },
    subscription: {
      status: "ACTIVE",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      plan: { isActive: true, slug: "basic" },
    },
    ...overrides,
  } as PublicProductCatalogCandidate["store"];
}

function productCandidate(
  id: string,
  overrides: Partial<PublicProductCatalogCandidate> = {},
): PublicProductCatalogCandidate {
  return {
    id,
    status: "ACTIVE",
    name: "Product",
    createdAt: new Date(`2025-01-${String(Number(id.slice(-2)) + 1).padStart(2, "0")}T00:00:00.000Z`),
    store: storeCandidate(),
    ...overrides,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cursorFromWhere(where: unknown): { name?: string; createdAt?: Date; id: string; operator: "gt" | "lt" } | null {
  const and = asRecord(where)?.AND;
  if (!Array.isArray(and)) return null;
  for (const condition of and) {
    const alternatives = asRecord(condition)?.OR;
    if (!Array.isArray(alternatives)) continue;
    for (const alternative of alternatives) {
      const row = asRecord(alternative);
      if (!row) continue;
      const name = asRecord(row.name);
      const createdAt = asRecord(row.createdAt);
      const nameOperator = typeof name?.gt === "string" ? "gt" : typeof name?.lt === "string" ? "lt" : null;
      if (name && nameOperator) {
        const nameValue = name[nameOperator];
        const matching = alternatives.map(asRecord).find((item) =>
          item !== null && item.name === nameValue && typeof asRecord(item.id)?.[nameOperator] === "string",
        );
        const id = asRecord(matching?.id)?.[nameOperator];
        if (typeof id === "string") return { name: nameValue as string, id, operator: nameOperator };
      }
      const dateOperator = createdAt?.lt instanceof Date ? "lt" : createdAt?.gt instanceof Date ? "gt" : null;
      if (createdAt && dateOperator) {
        const cursorDate = createdAt[dateOperator] as Date;
        const matching = alternatives.map(asRecord).find((item) =>
          item !== null && item.createdAt instanceof Date
            && item.createdAt.getTime() === cursorDate.getTime()
            && typeof asRecord(item.id)?.[dateOperator] === "string",
        );
        const id = asRecord(matching?.id)?.[dateOperator];
        if (typeof id === "string") return { createdAt: cursorDate, id, operator: dateOperator };
      }
    }
  }
  return null;
}

function compareForSort(
  left: PublicProductCatalogCandidate,
  right: PublicProductCatalogCandidate,
  sort: ProductCatalogSort,
) {
  if (sort === "name") {
    return compareOrdinal(left.name, right.name) || compareOrdinal(left.id, right.id);
  }
  return right.createdAt.getTime() - left.createdAt.getTime() || compareOrdinal(right.id, left.id);
}

function compareOrdinal(left: string, right: string) { return left < right ? -1 : left > right ? 1 : 0; }

function mockClient(
  rows: PublicProductCatalogCandidate[],
  sort: ProductCatalogSort,
  options: { missingIds?: string[]; failCandidates?: Error } = {},
) {
  const queries: PublicProductCatalogQuery[] = [];
  const ordered = [...rows].sort((left, right) => compareForSort(left, right, sort));
  const client: PublicProductCatalogClient<{ id: string; name: string }> = {
    async findCandidates(query) {
      queries.push(query);
      if (options.failCandidates) throw options.failCandidates;
      const cursor = cursorFromWhere(query.where);
      const firstOrder = query.orderBy[0];
      const reversed = "name" in firstOrder ? firstOrder.name === "desc" : firstOrder.createdAt === "asc";
      const traversal = reversed ? [...ordered].reverse() : ordered;
      const remaining = cursor ? traversal.filter((row) => {
        const original = compareForSort(row, { ...row, id: cursor.id, ...(cursor.name === undefined ? {} : { name: cursor.name }), ...(cursor.createdAt === undefined ? {} : { createdAt: cursor.createdAt }) }, sort);
        return reversed ? original < 0 : original > 0;
      }) : traversal;
      return remaining.slice(0, query.take);
    },
    async findRecords(ids) {
      return [...ids].reverse()
        .filter((id) => !options.missingIds?.includes(id))
        .map((id) => {
          const row = ordered.find((candidate) => candidate.id === id);
          if (!row) throw new Error(`Missing synthetic product ${id}`);
          return { id, name: row.name };
        });
    },
  };
  return { client, queries };
}

test("candidate predicate retains active, legal-base, city, store, category, and catalog text filters", () => {
  const where = publicProductCatalogCandidateWhere({
    citySlug: "baku",
    storeId: "store-1",
    categorySlug: "clothing",
    query: "cotton",
    searchFields: "catalog",
  });
  const serialized = JSON.stringify(where);

  assert.match(serialized, /"status":"ACTIVE"/);
  assert.match(serialized, /"legalInfoApproved":true/);
  assert.match(serialized, /"slug":"baku"/);
  assert.match(serialized, /"id":"store-1"/);
  assert.match(serialized, /"slug":"clothing"/);
  assert.match(serialized, /"contains":"cotton"/);
  assert.match(serialized, /"description"/);
  assert.match(serialized, /"sku"/);
});

test("candidate predicate preserves API name-only text search", () => {
  const serialized = JSON.stringify(publicProductCatalogCandidateWhere({ query: "shirt" }));
  assert.match(serialized, /"name":\{"contains":"shirt"/);
  assert.doesNotMatch(serialized, /"description"/);
  assert.doesNotMatch(serialized, /"sku"/);
});

test("trim-aware store policy rejects blanks and honors seller types and empty overrides", async () => {
  const previous = process.env.BAGATI_SELLER_LEGAL_POLICY;
  process.env.BAGATI_SELLER_LEGAL_POLICY = JSON.stringify({
    INDIVIDUAL_ENTREPRENEUR: ["legalName", "voen"],
    REGISTERED_COMPANY: [],
  });
  try {
    const rows = [
      productCandidate("product-01", { store: storeCandidate({ vendor: { ...storeCandidate().vendor, legalName: " \t\n" } }) }),
      productCandidate("product-02", { store: storeCandidate({ vendor: { ...storeCandidate().vendor, sellerType: "REGISTERED_COMPANY", legalName: null, voen: null } }) }),
      productCandidate("product-03", { store: storeCandidate({ vendor: { ...storeCandidate().vendor, legalName: "\u00a0Seller\ufeff" } }) }),
      productCandidate("product-04", { store: storeCandidate({ legalInfoApproved: false }) }),
    ];
    const { client } = mockClient(rows, "newest");
    const result = await findPublicProductCatalogPage(client, {}, {
      sort: "newest",
      limit: 10,
      exactTotal: true,
    });
    assert.equal(result.total, 2);
    assert.deepEqual(result.items.map(({ id }) => id), ["product-03", "product-02"]);
  } finally {
    if (previous === undefined) delete process.env.BAGATI_SELLER_LEGAL_POLICY;
    else process.env.BAGATI_SELLER_LEGAL_POLICY = previous;
  }
});

test("fills the requested page across batches and restores stable order after final fetch", async () => {
  const rows = [
    productCandidate("product-01", { name: "Same", store: storeCandidate({ legalInfoApproved: false }) }),
    productCandidate("product-02", { name: "Same" }),
    productCandidate("product-03", { name: "Same", store: storeCandidate({ vendor: { ...storeCandidate().vendor, voen: "\t" } }) }),
    productCandidate("product-04", { name: "Same" }),
    productCandidate("product-05", { name: "Same" }),
  ];
  const { client, queries } = mockClient(rows, "name");

  const result = await findPublicProductCatalogPage(client, {}, {
    sort: "name",
    limit: 3,
    batchSize: 2,
  });

  assert.deepEqual(result.items.map(({ id }) => id), ["product-02", "product-04", "product-05"]);
  assert.equal(result.items.length, 3);
  assert.equal(result.total, null);
  assert.equal(queries.length, 3);
  assert.match(JSON.stringify(queries[1].where), /"id":\{"gt":"product-02"\}/);
});

test("newest sorting uses descending product ID to stabilize equal creation times", async () => {
  const createdAt = new Date("2025-01-01T00:00:00.000Z");
  const { client } = mockClient([
    productCandidate("product-a", { createdAt }),
    productCandidate("product-c", { createdAt }),
    productCandidate("product-b", { createdAt }),
  ], "newest");

  const result = await findPublicProductCatalogPage(client, {}, {
    sort: "newest",
    limit: 3,
    exactTotal: true,
  });

  assert.deepEqual(result.items.map(({ id }) => id), ["product-c", "product-b", "product-a"]);
});

test("a full batch with no eligible products advances and rejects candidates at batch boundaries", async () => {
  const rows = [
    productCandidate("product-01", { name: "A", store: storeCandidate({ legalInfoApproved: false }) }),
    productCandidate("product-02", { name: "B", store: storeCandidate({ vendor: { ...storeCandidate().vendor, legalName: " " } }) }),
    productCandidate("product-03", { name: "C" }),
    productCandidate("product-04", { name: "D", store: storeCandidate({ legalInfoApproved: false }) }),
  ];
  const { client, queries } = mockClient(rows, "name");

  const result = await findPublicProductCatalogPage(client, {}, {
    sort: "name",
    limit: 10,
    batchSize: 2,
    exactTotal: true,
  });

  assert.deepEqual(result.items.map(({ id }) => id), ["product-03"]);
  assert.equal(result.total, 1);
  assert.equal(queries.length, 3);
  assert.match(JSON.stringify(queries[1].where), /"id":\{"gt":"product-02"\}/);
  assert.match(JSON.stringify(queries[2].where), /"id":\{"gt":"product-04"\}/);
});

test("exact total scans all candidates and page one/page two have stable boundaries", async () => {
  const rows = Array.from({ length: 8 }, (_, index) => productCandidate(
    `product-${String(index + 1).padStart(2, "0")}`,
    { store: storeCandidate(index === 3 || index === 6 ? { legalInfoApproved: false } : {}) },
  ));
  const pageOne = mockClient(rows, "newest");
  const first = await findPublicProductCatalogPage(pageOne.client, {}, {
    sort: "newest",
    limit: 3,
    batchSize: 2,
    exactTotal: true,
  });
  const pageTwo = mockClient(rows, "newest");
  const second = await findPublicProductCatalogPage(pageTwo.client, {}, {
    sort: "newest",
    offset: 3,
    limit: 3,
    batchSize: 2,
    exactTotal: true,
  });

  assert.deepEqual(first.items.map(({ id }) => id), ["product-08", "product-06", "product-05"]);
  assert.deepEqual(second.items.map(({ id }) => id), ["product-03", "product-02", "product-01"]);
  assert.equal(first.total, 6);
  assert.equal(second.total, 6);
  assert.equal(pageOne.queries.length, 5);
  assert.equal(pageTwo.queries.length, 5);
});

test("cursor pages preserve newest ordering, expose both directions, and continue without offset rescans", async () => {
  const dates = ["2025-01-05", "2025-01-04", "2025-01-03", "2025-01-02", "2025-01-01"];
  const rows = dates.map((date, index) => productCandidate(`page-${index + 1}`, { createdAt: new Date(`${date}T00:00:00.000Z`) }));
  const firstClient = mockClient(rows, "newest");
  const first = await findPublicProductCatalogPage(firstClient.client, {}, { sort: "newest", limit: 2, paginate: true, batchSize: 2 });
  assert.deepEqual(first.items.map(({ id }) => id), ["page-1", "page-2"]);
  assert.equal(first.hasPrevious, false);
  assert.equal(first.hasNext, true);
  assert.ok(first.nextCursor);

  const secondClient = mockClient(rows, "newest");
  const second = await findPublicProductCatalogPage(secondClient.client, {}, { sort: "newest", limit: 2, cursor: first.nextCursor!, paginate: true, batchSize: 2 });
  assert.deepEqual(second.items.map(({ id }) => id), ["page-3", "page-4"]);
  assert.equal(second.hasPrevious, true);
  assert.equal(second.hasNext, true);
  assert.equal(decodeProductCatalogCursor(second.previousCursor!)?.direction, "before");

  const previousClient = mockClient(rows, "newest");
  const previous = await findPublicProductCatalogPage(previousClient.client, {}, { sort: "newest", limit: 2, cursor: second.previousCursor!, paginate: true, batchSize: 2 });
  assert.deepEqual(previous.items.map(({ id }) => id), ["page-1", "page-2"]);
  assert.equal(firstClient.queries[0].take, 2);
});

test("cursor tokens are validated and filter predicates remain applied on continued pages", async () => {
  const { client, queries } = mockClient([productCandidate("page-1"), productCandidate("page-2")], "newest");
  await assert.rejects(findPublicProductCatalogPage(client, {}, { sort: "newest", limit: 2, cursor: "not-a-cursor", paginate: true }), { message: "PUBLIC_PRODUCT_CATALOG_CURSOR_INVALID" });

  const cursor = encodeProductCatalogCursor({ sort: "newest", createdAt: new Date("2025-01-01T00:00:00.000Z"), id: "page-1" }, "after");
  await findPublicProductCatalogPage(client, { citySlug: "baku", categorySlug: "clothing", query: "linen", searchFields: "catalog" }, { sort: "newest", limit: 2, cursor, paginate: true });
  const where = JSON.stringify(queries[0].where);
  assert.match(where, /"slug":"baku"/);
  assert.match(where, /"slug":"clothing"/);
  assert.match(where, /"contains":"linen"/);
});

test("all cursor pages are disjoint and complete for tied names and timestamps", async () => {
  const createdAt = new Date("2025-01-01T00:00:00.000Z");
  const rows = ["a", "b", "c", "d", "e", "f", "g"].map((id) => productCandidate(`product-${id}`, { name: "Same", createdAt }));
  for (const sort of ["name", "newest"] as const) {
    const collected: string[] = [];
    let cursor: string | undefined;
    for (let pageCount = 0; pageCount < 10; pageCount += 1) {
      const { client } = mockClient(rows, sort);
      const page = await findPublicProductCatalogPage(client, {}, { sort, limit: 2, paginate: true, cursor });
      collected.push(...page.items.map(({ id }) => id));
      cursor = page.nextCursor ?? undefined;
      if (!page.hasNext) break;
      assert.ok(cursor, "hasNext must include a usable cursor");
    }
    const expected = [...rows].sort((a, b) => compareForSort(a, b, sort)).map(({ id }) => id);
    assert.deepEqual(collected, expected);
    assert.equal(new Set(collected).size, rows.length);
  }
});

test("deleted cursor records do not strand the result set, and empty reverse pages recover", async () => {
  const rows = Array.from({ length: 5 }, (_, index) => productCandidate(`product-${index + 1}`, { createdAt: new Date(`2025-01-0${index + 1}T00:00:00.000Z`) }));
  const first = await findPublicProductCatalogPage(mockClient(rows, "newest").client, {}, { sort: "newest", limit: 2, paginate: true });
  const cursor = decodeProductCatalogCursor(first.nextCursor!)!;
  const remaining = rows.filter(({ id }) => id !== cursor.cursor.id);
  const next = await findPublicProductCatalogPage(mockClient(remaining, "newest").client, {}, { sort: "newest", limit: 2, cursor: first.nextCursor! });
  assert.deepEqual(next.items.map(({ id }) => id), ["product-3", "product-2"]);
  const back = await findPublicProductCatalogPage(mockClient(remaining, "newest").client, {}, { sort: "newest", limit: 2, cursor: next.previousCursor! });
  assert.deepEqual(back.items.map(({ id }) => id), ["product-5"]);

  const futureCursor = encodeProductCatalogCursor({ sort: "newest", id: "deleted", createdAt: new Date("2030-01-01T00:00:00.000Z") }, "before");
  const empty = await findPublicProductCatalogPage(mockClient([], "newest").client, {}, { sort: "newest", limit: 2, cursor: futureCursor });
  assert.equal(empty.items.length, 0);
  assert.equal(empty.hasNext, true);
  assert.ok(empty.nextCursor);
  const stillEmpty = await findPublicProductCatalogPage(mockClient([], "newest").client, {}, { sort: "newest", limit: 2, cursor: empty.nextCursor! });
  assert.equal(stillEmpty.hasPrevious, false);
  assert.equal(stillEmpty.previousCursor, null);
});

test("an empty backward scan continues in the same direction when its bounded budget finds only ineligible products", async () => {
  const rows = Array.from({ length: 5 }, (_, index) => productCandidate(`back-${index}`, {
    createdAt: new Date(`2025-01-0${index + 1}T00:00:00.000Z`),
    ...(index < 2 ? { store: storeCandidate({ legalInfoApproved: false }) } : {}),
  }));
  const boundary = encodeProductCatalogCursor({ sort: "newest", createdAt: new Date("2025-01-01T00:00:00.000Z"), id: "anchor" }, "before");
  const firstClient = mockClient(rows, "newest");
  const first = await findPublicProductCatalogPage(firstClient.client, {}, {
    sort: "newest", limit: 2, cursor: boundary, paginate: true, batchSize: 2, maxScanRows: 2,
  });
  assert.deepEqual(first.items, []);
  assert.equal(firstClient.queries.reduce((sum, query) => sum + query.take, 0), 3);
  assert.equal(first.hasPrevious, true);
  assert.equal(first.hasNext, false);
  assert.equal(decodeProductCatalogCursor(first.previousCursor!)?.direction, "before");

  const nextWindow = await findPublicProductCatalogPage(mockClient(rows, "newest").client, {}, {
    sort: "newest", limit: 2, cursor: first.previousCursor!, paginate: true, batchSize: 2, maxScanRows: 2,
  });
  assert.deepEqual(nextWindow.items.map(({ id }) => id), ["back-3", "back-2"]);
});

test("sparse eligibility has a bounded scan and an advancing continuation cursor", async () => {
  const rows = Array.from({ length: 10 }, (_, index) => productCandidate(`product-${String(index + 1).padStart(2, "0")}`, {
    createdAt: new Date(`2025-01-${String(10 - index).padStart(2, "0")}T00:00:00.000Z`),
    ...(index === 0 || index === 3 || index === 4 || index === 7 ? {} : { store: storeCandidate({ legalInfoApproved: false }) }),
  }));
  const firstClient = mockClient(rows, "newest");
  const first = await findPublicProductCatalogPage(firstClient.client, {}, { sort: "newest", limit: 2, paginate: true, batchSize: 2, maxScanRows: 4 });
  assert.deepEqual(first.items.map(({ id }) => id), ["product-01", "product-04"]);
  assert.equal(first.hasNext, true);
  assert.equal(firstClient.queries.reduce((sum, query) => sum + query.take, 0), 5);
  const second = await findPublicProductCatalogPage(mockClient(rows, "newest").client, {}, { sort: "newest", limit: 2, cursor: first.nextCursor!, batchSize: 2, maxScanRows: 4 });
  assert.deepEqual(second.items.map(({ id }) => id), ["product-05", "product-08"]);
});

test("cursor API payload is bounded and keeps a stable response contract without an exact total", async () => {
  const page = await findPublicProductCatalogPage(mockClient([productCandidate("product-01")], "newest").client, {}, { sort: "newest", limit: 20, paginate: true });
  const payload = publicProductCatalogCursorResponse(page);
  assert.deepEqual(Object.keys(payload).sort(), ["hasNext", "hasPrevious", "items", "nextCursor", "pageSize", "previousCursor"].sort());
  assert.equal(payload.pageSize, 20);
  assert.equal(payload.items.length, 1);
});

test("candidate exhaustion returns fewer results and counts only eligible active products", async () => {
  const rows = [
    productCandidate("product-01"),
    productCandidate("product-02", { status: "DRAFT" }),
    productCandidate("product-03", { store: storeCandidate({ vendor: { ...storeCandidate().vendor, legalName: " " } }) }),
    productCandidate("product-04"),
  ];
  const { client, queries } = mockClient(rows, "newest");

  const result = await findPublicProductCatalogPage(client, {}, {
    sort: "newest",
    limit: 10,
    batchSize: 2,
    exactTotal: true,
  });

  assert.deepEqual(result.items.map(({ id }) => id), ["product-04", "product-01"]);
  assert.equal(result.total, 2);
  assert.equal(queries.length, 3);
});

test("uses one supplied time across candidate batches for subscription eligibility", async () => {
  const now = new Date("2025-01-15T00:00:00.000Z");
  const rows = Array.from({ length: 4 }, (_, index) => productCandidate(
    `product-0${index + 1}`,
    { store: storeCandidate({ subscription: {
      status: "ACTIVE",
      currentPeriodStart: new Date("2025-01-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2025-02-01T00:00:00.000Z"),
      plan: { isActive: true, slug: "basic" },
    } }) },
  ));
  const { client, queries } = mockClient(rows, "newest");

  await findPublicProductCatalogPage(client, {}, {
    sort: "newest",
    now,
    limit: 1,
    exactTotal: true,
    batchSize: 2,
  });

  assert.equal(queries.length, 3);
  for (const query of queries) {
    assert.match(JSON.stringify(query.where), /"gt":"2025-01-15T00:00:00.000Z"/);
  }
});

test("query and final-fetch failures propagate and missing records fail explicitly", async () => {
  const queryFailure = new Error("candidate query failed");
  const failedClient = mockClient([productCandidate("product-01")], "newest", { failCandidates: queryFailure });
  await assert.rejects(
    findPublicProductCatalogPage(failedClient.client, {}, { sort: "newest", limit: 1 }),
    queryFailure,
  );

  const missingClient = mockClient([productCandidate("product-01")], "newest", { missingIds: ["product-01"] });
  await assert.rejects(
    findPublicProductCatalogPage(missingClient.client, {}, { sort: "newest", limit: 1 }),
    { message: "PUBLIC_PRODUCT_CATALOG_RESULT_CHANGED" },
  );
});

test("invalid page sizes and candidate batch limits fail explicitly", async () => {
  const { client } = mockClient([], "newest");
  await assert.rejects(
    findPublicProductCatalogPage(client, {}, { sort: "newest", limit: 51 }),
    { message: "PUBLIC_PRODUCT_CATALOG_PAGINATION_OUT_OF_RANGE" },
  );
  await assert.rejects(
    findPublicProductCatalogPage(client, {}, { sort: "newest", limit: 1, batchSize: 501 }),
    { message: "PUBLIC_PRODUCT_CATALOG_BATCH_SIZE_OUT_OF_RANGE" },
  );
});
