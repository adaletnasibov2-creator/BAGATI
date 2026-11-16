import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { findPublicProductsByIds, parseProductIdsParam, PUBLIC_PRODUCT_BATCH_MAX_IDS } from "../lib/public-product-batch";
import { productIdBatches } from "../lib/product-id-batches";

const ids = (count: number) => Array.from({ length: count }, (_, index) => `p${index}`);

test("ids: at most 50 entries, otherwise an error (400)", () => {
  assert.equal(PUBLIC_PRODUCT_BATCH_MAX_IDS, 50);
  assert.deepEqual(parseProductIdsParam(ids(50).join(",")), { ids: ids(50) });
  assert.ok("error" in parseProductIdsParam(ids(51).join(",")));
  // The cap counts entries as sent, duplicates included.
  assert.ok("error" in parseProductIdsParam([...ids(50), "p0"].join(",")));
});

test("ids: empty, malformed and over-long ids are rejected; duplicates removed in first-seen order", () => {
  for (const raw of [null, "", " , ,", "a b", "a,../b", "a,<script>", "x".repeat(65)]) assert.ok("error" in parseProductIdsParam(raw), String(raw));
  assert.deepEqual(parseProductIdsParam(" b , a,b,c-1,d_2 "), { ids: ["b", "a", "c-1", "d_2"] });
});

type Item = { id: string; store: { id: string } };
function deps(items: Item[], eligibleStores: string[]) {
  const calls = { find: [] as string[][], eligibility: [] as string[][] };
  return {
    calls,
    deps: {
      findProducts: async (requested: string[]) => { calls.find.push(requested); return items.filter((item) => requested.includes(item.id)); },
      resolveEligibleStores: async (storeIds: string[]) => { calls.eligibility.push(storeIds); return new Set(storeIds.filter((id) => eligibleStores.includes(id))); },
    },
  };
}

test("batch: products of ineligible stores and unknown ids are left out; request order is kept", async () => {
  const items = [{ id: "a", store: { id: "s1" } }, { id: "b", store: { id: "s2" } }, { id: "c", store: { id: "s1" } }];
  const { deps: d, calls } = deps(items, ["s1"]);
  const result = await findPublicProductsByIds(["c", "missing", "b", "a"], d);
  assert.deepEqual(result.map((item) => item.id), ["c", "a"]);
  assert.equal(calls.find.length, 1, "one products query for the whole batch");
  assert.deepEqual(calls.eligibility, [["s1", "s2"]], "one eligibility check over the distinct stores");
});

test("batch: no queries for an empty list, no eligibility query when nothing is found, over 50 throws", async () => {
  const { deps: d, calls } = deps([], ["s1"]);
  assert.deepEqual(await findPublicProductsByIds([], d), []);
  assert.deepEqual(await findPublicProductsByIds(["x"], d), []);
  assert.equal(calls.find.length, 1);
  assert.equal(calls.eligibility.length, 0);
  await assert.rejects(findPublicProductsByIds(ids(51), d), /PUBLIC_PRODUCT_BATCH_TOO_MANY_IDS/);
});

test("favorites client: batches of 50, invalid entries dropped first, duplicates removed, order kept", () => {
  const saved = [...ids(120), "p3", "bad id", 42, null, "p0"];
  const batches = productIdBatches(saved);
  assert.deepEqual(batches.map((batch) => batch.length), [50, 50, 20]);
  assert.deepEqual(batches.flat(), ids(120));
  assert.deepEqual(productIdBatches([]), []);
});

test("favorites page uses the batch endpoint; the single endpoint keeps the same fields", () => {
  const root = join(__dirname, "..");
  const client = readFileSync(join(root, "components", "favorites-client.tsx"), "utf8");
  assert.match(client, /\/api\/products\?ids=/);
  assert.doesNotMatch(client, /fetch\(`\/api\/products\/\$\{id\}`\)/);
  const single = readFileSync(join(root, "app", "api", "products", "[id]", "route.ts"), "utf8");
  assert.match(single, /include: publicProductDetailInclude/);
  assert.match(single, /resolvePublicStoreEligibility\(\[item\.store\.id\]\)/);
});
