import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeStoreDiscoveryCursor,
  encodeStoreDiscoveryCursor,
  findPublicStoreDiscoveryCursorPage,
  findPublicStoreDiscoveryPage,
  publicStoreDiscoveryCursorResponse,
  PUBLIC_STORE_DISCOVERY_MAX_SCAN_ROWS,
  PUBLIC_STORE_DISCOVERY_PAGE_SIZE,
  type PublicStoreDiscoveryCandidate,
  type PublicStoreDiscoveryClient,
  type PublicStoreDiscoveryQuery,
  type PublicStoreDiscoveryRecord,
} from "../lib/public-store-discovery";

function candidate(
  id: string,
  overrides: Partial<PublicStoreDiscoveryCandidate> = {},
): PublicStoreDiscoveryCandidate {
  return {
    id,
    name: "Store",
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
  };
}

function storeRecord(id: string, name: string): PublicStoreDiscoveryRecord {
  return {
    id,
    name,
    slug: id,
    description: null,
    logoUrl: null,
    latitude: null,
    longitude: null,
    city: { name: "Baku", slug: "baku" },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cursorFromWhere(where: unknown): { name: string; id: string; operator: "gt" | "lt" } | null {
  const and = asRecord(where)?.AND;
  if (!Array.isArray(and)) return null;

  for (const condition of and) {
    const disjunction = asRecord(condition)?.OR;
    if (!Array.isArray(disjunction)) continue;
    const alternatives = disjunction.map(asRecord);
    const nameAlternative = alternatives.find((item) => typeof asRecord(item?.name)?.gt === "string" || typeof asRecord(item?.name)?.lt === "string");
    const nameCondition = asRecord(nameAlternative?.name);
    const operator = typeof nameCondition?.gt === "string" ? "gt" : "lt";
    const name = nameCondition?.[operator];
    const idAlternative = alternatives.find((item) =>
      item !== null && item.name === name && typeof asRecord(item.id)?.[operator] === "string",
    );
    const id = asRecord(idAlternative?.id)?.[operator];
    if (typeof name === "string" && typeof id === "string") return { name, id, operator };
  }
  return null;
}

function mockDiscoveryClient(
  rows: PublicStoreDiscoveryCandidate[],
  options: { missingFinalIds?: string[] } = {},
) {
  const queries: PublicStoreDiscoveryQuery[] = [];
  const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
  const ordered = [...rows].sort((left, right) => compare(left.name, right.name) || compare(left.id, right.id));
  const client: PublicStoreDiscoveryClient = {
    async findCandidates(query) {
      queries.push(query);
      const cursor = cursorFromWhere(query.where);
      const reversed = query.orderBy[0].name === "desc";
      const traversal = reversed ? [...ordered].reverse() : ordered;
      const afterCursor = cursor ? traversal.filter((row) => {
        const comparison = compare(row.name, cursor.name) || compare(row.id, cursor.id);
        return reversed ? comparison < 0 : comparison > 0;
      }) : traversal;
      return afterCursor.slice(0, query.take);
    },
    async findStoresByIds(ids) {
      return [...ids].reverse().filter((id) => !options.missingFinalIds?.includes(id)).map((id) => {
        const row = ordered.find((item) => item.id === id);
        if (!row) throw new Error(`Missing synthetic store ${id}`);
        return storeRecord(row.id, row.name);
      });
    },
  };
  return { client, queries };
}

test("store discovery uses deterministic name and unique ID ordering", async () => {
  const { client, queries } = mockDiscoveryClient([
    candidate("store-c"),
    candidate("store-a"),
    candidate("store-b"),
    candidate("store-z", { name: "Another" }),
  ]);

  const result = await findPublicStoreDiscoveryPage(client, {}, { batchSize: 2 });

  assert.deepEqual(result.map(({ id }) => id), ["store-z", "store-a", "store-b", "store-c"]);
  assert.deepEqual(queries[0].orderBy, [{ name: "asc" }, { id: "asc" }]);
});

test("cursor discovery handles sparse eligible stores and previous/next boundaries", async () => {
  const rows = Array.from({ length: 9 }, (_, index) => candidate(`store-${String(index + 1).padStart(2, "0")}`, {
    name: `Store ${String(index + 1).padStart(2, "0")}`,
    ...(index === 1 || index === 2 || index === 4 || index === 5 ? { legalInfoApproved: false } : {}),
  }));
  const firstClient = mockDiscoveryClient(rows);
  const first = await findPublicStoreDiscoveryCursorPage(firstClient.client, {}, { pageSize: 2, batchSize: 3 });
  assert.deepEqual(first.items.map(({ id }) => id), ["store-01", "store-04"]);
  assert.equal(first.hasPrevious, false);
  assert.equal(first.hasNext, true);
  assert.ok(first.nextCursor);

  const secondClient = mockDiscoveryClient(rows);
  const second = await findPublicStoreDiscoveryCursorPage(secondClient.client, {}, { pageSize: 2, batchSize: 3, cursor: first.nextCursor! });
  assert.deepEqual(second.items.map(({ id }) => id), ["store-07", "store-08"]);
  assert.equal(second.hasPrevious, true);
  assert.equal(second.hasNext, true);
  assert.equal(decodeStoreDiscoveryCursor(second.previousCursor!)?.direction, "before");

  const previousClient = mockDiscoveryClient(rows);
  const previous = await findPublicStoreDiscoveryCursorPage(previousClient.client, {}, { pageSize: 2, batchSize: 3, cursor: second.previousCursor! });
  assert.deepEqual(previous.items.map(({ id }) => id), ["store-01", "store-04"]);
  assert.ok(encodeStoreDiscoveryCursor({ name: "Store 07", id: "store-07" }, "after"));
});

test("cursor discovery rejects malformed cursors and never exceeds the configured page bound", async () => {
  const { client } = mockDiscoveryClient([]);
  await assert.rejects(findPublicStoreDiscoveryCursorPage(client, {}, { cursor: "bad", pageSize: 2 }), { message: "PUBLIC_STORE_DISCOVERY_CURSOR_INVALID" });
  await assert.rejects(findPublicStoreDiscoveryCursorPage(client, {}, { pageSize: 51 }), { message: "PUBLIC_STORE_DISCOVERY_PAGE_SIZE_OUT_OF_RANGE" });
});

test("cursor pages are disjoint and complete for duplicate store names", async () => {
  const rows = ["a", "b", "c", "d", "e", "f", "g"].map((id) => candidate(`store-${id}`, { name: "Same name" }));
  const collected: string[] = [];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const page = await findPublicStoreDiscoveryCursorPage(mockDiscoveryClient(rows).client, {}, { pageSize: 2, cursor });
    collected.push(...page.items.map(({ id }) => id));
    cursor = page.nextCursor ?? undefined;
    if (!page.hasNext) break;
    assert.ok(cursor);
  }
  assert.deepEqual(collected, ["store-a", "store-b", "store-c", "store-d", "store-e", "store-f", "store-g"]);
  assert.equal(new Set(collected).size, rows.length);
});

test("deleted cursor store remains traversable and empty before pages return to existing results", async () => {
  const rows = ["a", "b", "c", "d", "e"].map((id) => candidate(`store-${id}`, { name: id.toUpperCase() }));
  const first = await findPublicStoreDiscoveryCursorPage(mockDiscoveryClient(rows).client, {}, { pageSize: 2 });
  const cursor = decodeStoreDiscoveryCursor(first.nextCursor!)!;
  const remaining = rows.filter(({ id }) => id !== cursor.id);
  const next = await findPublicStoreDiscoveryCursorPage(mockDiscoveryClient(remaining).client, {}, { pageSize: 2, cursor: first.nextCursor! });
  assert.deepEqual(next.items.map(({ id }) => id), ["store-c", "store-d"]);
  const back = await findPublicStoreDiscoveryCursorPage(mockDiscoveryClient(remaining).client, {}, { pageSize: 2, cursor: next.previousCursor! });
  assert.deepEqual(back.items.map(({ id }) => id), ["store-a"]);

  const before = encodeStoreDiscoveryCursor({ name: "", id: "deleted" }, "before");
  const empty = await findPublicStoreDiscoveryCursorPage(mockDiscoveryClient(rows).client, {}, { pageSize: 2, cursor: before });
  assert.equal(empty.items.length, 0);
  assert.equal(empty.hasNext, true);
  assert.ok(empty.nextCursor);
  const stillEmpty = await findPublicStoreDiscoveryCursorPage(mockDiscoveryClient([]).client, {}, { pageSize: 2, cursor: empty.nextCursor! });
  assert.equal(stillEmpty.hasPrevious, false);
  assert.equal(stillEmpty.previousCursor, null);
});

test("sparse store eligibility scans a fixed budget and advances without skipping candidates", async () => {
  const rows = Array.from({ length: 10 }, (_, index) => candidate(`store-${String(index + 1).padStart(2, "0")}`, {
    name: `Store ${String(index + 1).padStart(2, "0")}`,
    ...(index === 0 || index === 3 || index === 4 || index === 7 ? {} : { legalInfoApproved: false }),
  }));
  const firstClient = mockDiscoveryClient(rows);
  const first = await findPublicStoreDiscoveryCursorPage(firstClient.client, {}, { pageSize: 2, batchSize: 2, maxScanRows: 4 });
  assert.deepEqual(first.items.map(({ id }) => id), ["store-01", "store-04"]);
  assert.equal(first.hasNext, true);
  assert.equal(firstClient.queries.reduce((sum, query) => sum + query.take, 0), 5);
  const second = await findPublicStoreDiscoveryCursorPage(mockDiscoveryClient(rows).client, {}, { pageSize: 2, cursor: first.nextCursor!, batchSize: 2, maxScanRows: 4 });
  assert.deepEqual(second.items.map(({ id }) => id), ["store-05", "store-08"]);
});

test("an empty backward scan continues in the same direction when its bounded budget finds only ineligible stores", async () => {
  const rows = ["Y", "X", "W", "V", "U"].map((name, index) => candidate(`back-${index}`, {
    name,
    ...(index < 2 ? { legalInfoApproved: false } : {}),
  }));
  const boundary = encodeStoreDiscoveryCursor({ name: "Z", id: "anchor" }, "before");
  const firstClient = mockDiscoveryClient(rows);
  const first = await findPublicStoreDiscoveryCursorPage(firstClient.client, {}, {
    pageSize: 2, cursor: boundary, batchSize: 2, maxScanRows: 2,
  });
  assert.deepEqual(first.items, []);
  assert.equal(firstClient.queries.reduce((sum, query) => sum + query.take, 0), 3);
  assert.equal(first.hasPrevious, true);
  assert.equal(first.hasNext, false);
  assert.equal(decodeStoreDiscoveryCursor(first.previousCursor!)?.direction, "before");

  const nextWindow = await findPublicStoreDiscoveryCursorPage(mockDiscoveryClient(rows).client, {}, {
    pageSize: 2, cursor: first.previousCursor!, batchSize: 2, maxScanRows: 2,
  });
  assert.deepEqual(nextWindow.items.map(({ id }) => id), ["back-3", "back-2"]);
});

test("the production scan ceiling is finite", () => {
  assert.equal(PUBLIC_STORE_DISCOVERY_MAX_SCAN_ROWS, 500);
});

test("bounded store API response includes the legacy item fields and cursor metadata", async () => {
  const page = await findPublicStoreDiscoveryCursorPage(mockDiscoveryClient([candidate("store-01")]).client, {}, { pageSize: 20 });
  const payload = publicStoreDiscoveryCursorResponse(page);
  assert.deepEqual(Object.keys(payload).sort(), ["hasNext", "hasPrevious", "items", "nextCursor", "pageSize", "previousCursor"].sort());
  assert.deepEqual(Object.keys(payload.items[0]).sort(), ["city", "description", "id", "latitude", "logoUrl", "longitude", "name", "slug"].sort());
  assert.equal(payload.items[0].slug, "store-01");
  assert.equal(payload.items[0].city.slug, "baku");
});

test("cursor advances past ineligible candidates and fills all 60 slots", async () => {
  const rows = Array.from({ length: 90 }, (_, index) => {
    const number = index + 1;
    const id = `store-${String(number).padStart(3, "0")}`;
    return candidate(id, {
      name: "Same name",
      vendor: {
        ...candidate("base").vendor,
        legalName: number % 5 === 0 ? " \t\n" : "Seller",
      },
    });
  });
  const { client, queries } = mockDiscoveryClient(rows);

  const result = await findPublicStoreDiscoveryPage(client, {}, { batchSize: 20 });

  assert.equal(result.length, PUBLIC_STORE_DISCOVERY_PAGE_SIZE);
  assert.equal(result.at(-1)?.id, "store-074");
  assert.equal(queries.length, 4);
  assert.match(JSON.stringify(queries[1].where), /"id":\{"gt":"store-020"\}/);
});

test("a full batch with no eligible candidates advances to later batches", async () => {
  const rows = [
    ...Array.from({ length: 4 }, (_, index) => candidate(`a-${index}`, {
      vendor: { ...candidate("base").vendor, legalName: " \t" },
    })),
    ...Array.from({ length: 4 }, (_, index) => candidate(`b-${index}`)),
  ];
  const { client, queries } = mockDiscoveryClient(rows);

  const result = await findPublicStoreDiscoveryPage(client, {}, { batchSize: 4 });

  assert.deepEqual(result.map(({ id }) => id), ["b-0", "b-1", "b-2", "b-3"]);
  assert.equal(queries.length, 3);
  assert.match(JSON.stringify(queries[1].where), /"id":\{"gt":"a-3"\}/);
});

test("ineligible candidates at batch start, middle, and end do not disrupt the cursor", async () => {
  const rows = [
    candidate("a-start", { name: "A", vendor: { ...candidate("base").vendor, voen: "\t" } }),
    candidate("b-valid", { name: "B" }),
    candidate("c-middle", { name: "C", vendor: { ...candidate("base").vendor, legalName: " " } }),
    candidate("d-valid", { name: "D" }),
    candidate("e-end", { name: "E", legalInfoApproved: false }),
    candidate("f-valid", { name: "F" }),
  ];
  const { client, queries } = mockDiscoveryClient(rows);

  const result = await findPublicStoreDiscoveryPage(client, {}, { batchSize: 3 });

  assert.deepEqual(result.map(({ id }) => id), ["b-valid", "d-valid", "f-valid"]);
  assert.match(JSON.stringify(queries[1].where), /"name":"C","id":\{"gt":"c-middle"\}/);
});

test("returns fewer than 60 only after the candidate stream is exhausted", async () => {
  const { client, queries } = mockDiscoveryClient(
    Array.from({ length: 23 }, (_, index) => candidate(`store-${String(index + 1).padStart(3, "0")}`)),
  );

  const result = await findPublicStoreDiscoveryPage(client, {}, { batchSize: 7 });

  assert.equal(result.length, 23);
  assert.deepEqual(queries.map(({ take }) => take), [7, 7, 7, 7]);
});

test("more than 60 candidates with fewer than 60 eligible results exhausts the stream", async () => {
  const rows = Array.from({ length: 83 }, (_, index) => candidate(
    `store-${String(index + 1).padStart(3, "0")}`,
    index < 43 ? {} : { legalInfoApproved: false },
  ));
  const { client, queries } = mockDiscoveryClient(rows);

  const result = await findPublicStoreDiscoveryPage(client, {}, { batchSize: 20 });

  assert.equal(result.length, 43);
  assert.equal(queries.at(-1)?.take, 20);
  assert.equal(cursorFromWhere(queries.at(-1)?.where)?.id, "store-080");
});

test("retains database-expressible public eligibility and existing discovery filters", async () => {
  const { client, queries } = mockDiscoveryClient([candidate("store-001")]);

  await findPublicStoreDiscoveryPage(
    client,
    { citySlug: "baku", query: "market" },
    { batchSize: 10, now: new Date("2025-01-01T00:00:00.000Z") },
  );

  const where = JSON.stringify(queries[0].where);
  assert.match(where, /"isActive":true/);
  assert.match(where, /"status":"ACTIVE"/);
  assert.match(where, /"legalInfoApproved":true/);
  assert.match(where, /"adminManaged":true/);
  assert.match(where, /"slug":"baku"/);
  assert.match(where, /"contains":"market"/);
  assert.match(where, /"currentPeriodStart"/);
  assert.match(where, /"currentPeriodEnd"/);
});

test("trim-aware eligibility keeps approval and seller-policy requirements independent", async () => {
  const previous = process.env.BAGATI_SELLER_LEGAL_POLICY;
  process.env.BAGATI_SELLER_LEGAL_POLICY = JSON.stringify({
    INDIVIDUAL_ENTREPRENEUR: ["legalName", "voen"],
    REGISTERED_COMPANY: [],
  });
  try {
    const rows = [
      candidate("blank", { vendor: { ...candidate("base").vendor, legalName: "\t\n" } }),
      candidate("unapproved", { legalInfoApproved: false }),
      candidate("valid", {
        vendor: {
          ...candidate("base").vendor,
          legalName: "\u00a0Seller\ufeff",
        },
      }),
      candidate("empty-company-policy", {
        vendor: {
          ...candidate("base").vendor,
          sellerType: "REGISTERED_COMPANY",
          legalName: null,
          voen: null,
        },
      }),
    ];
    const { client } = mockDiscoveryClient(rows);

    const result = await findPublicStoreDiscoveryPage(client);

    assert.deepEqual(result.map(({ id }) => id), ["empty-company-policy", "valid"]);
  } finally {
    if (previous === undefined) delete process.env.BAGATI_SELLER_LEGAL_POLICY;
    else process.env.BAGATI_SELLER_LEGAL_POLICY = previous;
  }
});

test("uses the same supplied time for subscription filtering and eligibility", async () => {
  const now = new Date("2025-01-01T00:00:00.000Z");
  const { client, queries } = mockDiscoveryClient([
    candidate("valid-period", {
      subscription: {
        status: "ACTIVE",
        currentPeriodStart: new Date("2024-12-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2025-02-01T00:00:00.000Z"),
        plan: { isActive: true, slug: "basic" },
      },
    }),
  ]);

  const result = await findPublicStoreDiscoveryPage(client, {}, { now });

  assert.equal(result.length, 1);
  assert.match(JSON.stringify(queries[0].where), /"gt":"2025-01-01T00:00:00.000Z"/);
});

test("restores candidate order and fails explicitly if a selected record is missing", async () => {
  const { client } = mockDiscoveryClient([
    candidate("store-b", { name: "Same" }),
    candidate("store-a", { name: "Same" }),
  ]);

  const ordered = await findPublicStoreDiscoveryPage(client);
  assert.deepEqual(ordered.map(({ id }) => id), ["store-a", "store-b"]);

  const missingRecordClient = mockDiscoveryClient(
    [candidate("store-a")],
    { missingFinalIds: ["store-a"] },
  );
  await assert.rejects(
    findPublicStoreDiscoveryPage(missingRecordClient.client),
    { message: "PUBLIC_STORE_DISCOVERY_RESULT_CHANGED" },
  );
});
