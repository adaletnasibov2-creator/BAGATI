import assert from "node:assert/strict";
import test from "node:test";
import { createKeyedTtlCache } from "../lib/keyed-ttl-cache";
import {
  createPublicCategoryDataReader,
  normalizePublicCategoryCityKey,
  PUBLIC_CATEGORY_CACHE_MAX_KEYS,
  PUBLIC_CATEGORY_CACHE_TTL_MS,
} from "../lib/public-category-tree";
import type { CategoryRow } from "../lib/category-tree";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const rows: CategoryRow[] = [
  { id: "top", name: "Elektronika", slug: "elektronika", parentId: null, isActive: true, sortOrder: 1, iconKey: null, imageUrl: null },
  { id: "child", name: "Telefonlar", slug: "telefonlar", parentId: "top", isActive: true, sortOrder: 1, iconKey: null, imageUrl: null },
  { id: "empty", name: "Boş", slug: "bos", parentId: null, isActive: true, sortOrder: 2, iconKey: null, imageUrl: null },
];

function harness(options: { showEmpty?: boolean | null } = {}) {
  let now = 1_000_000;
  const calls = { rows: 0, counts: [] as (string | null)[], setting: 0 };
  const state = { showEmpty: options.showEmpty ?? null as boolean | null, childCount: 3 };
  const reader = createPublicCategoryDataReader({
    clock: () => now,
    loadRows: async () => { calls.rows += 1; return rows; },
    loadCounts: async (city) => { calls.counts.push(city); return new Map([["child", state.childCount]]); },
    readShowEmptySetting: async () => { calls.setting += 1; return state.showEmpty; },
  });
  return { reader, calls, state, advance: (ms: number) => { now += ms; } };
}

test("undefined, null and empty string share one key; other values are used as given", () => {
  assert.equal(normalizePublicCategoryCityKey(undefined), null);
  assert.equal(normalizePublicCategoryCityKey(null), null);
  assert.equal(normalizePublicCategoryCityKey(""), null);
  assert.equal(normalizePublicCategoryCityKey("qazax"), "qazax");
  assert.equal(normalizePublicCategoryCityKey(" qazax"), " qazax");
});

test("a second read within the TTL is a cache hit, also across undefined / null / empty string", async () => {
  const { reader, calls } = harness();
  const first = await reader.read();
  await reader.read(null);
  await reader.read("");
  assert.equal(calls.rows, 1);
  assert.deepEqual(calls.counts, [null]);
  assert.equal(first.counts.get("child"), 3);
  assert.equal(first.tree.find((node) => node.id === "top")?.count, 3);
});

test("concurrent reads of one key share one load", async () => {
  const { reader, calls } = harness();
  await Promise.all([reader.read(), reader.read(null), reader.read(undefined)]);
  assert.equal(calls.rows, 1);
});

test("different cities are different keys", async () => {
  const { reader, calls } = harness();
  await reader.read();
  await reader.read("qazax");
  await reader.read("qazax");
  assert.deepEqual(calls.counts, [null, "qazax"]);
});

test("the entry expires after 30 s", async () => {
  const { reader, calls, state, advance } = harness();
  await reader.read();
  state.childCount = 7;
  advance(PUBLIC_CATEGORY_CACHE_TTL_MS - 1);
  assert.equal((await reader.read()).counts.get("child"), 3);
  advance(1);
  assert.equal((await reader.read()).counts.get("child"), 7);
  assert.equal(calls.rows, 2);
});

test("invalidate() makes the next read load again", async () => {
  const { reader, calls, state } = harness();
  await reader.read();
  await reader.read("qazax");
  state.childCount = 0;
  reader.invalidate();
  assert.equal(reader.size(), 0);
  assert.equal((await reader.read()).counts.get("child"), 0);
  assert.equal(calls.rows, 3);
});

test("a load that started before invalidate() is not stored", async () => {
  const gate = deferred<string>();
  const cache = createKeyedTtlCache<string, string>({ ttlMs: 30_000, maxKeys: 4, clock: () => 0 });
  const slow = cache.get("k", () => gate.promise);
  await Promise.resolve();
  cache.invalidate();
  const fresh = cache.get("k", async () => "after-write");
  gate.resolve("before-write");
  assert.equal(await slow, "before-write");
  assert.equal(await fresh, "after-write");
  assert.equal(await cache.get("k", async () => "unexpected"), "after-write");
});

test("load errors propagate and are not cached, also when load throws synchronously", async () => {
  const cache = createKeyedTtlCache<string, string>({ ttlMs: 30_000, maxKeys: 4, clock: () => 0 });
  await assert.rejects(cache.get("k", async () => { throw new Error("db down"); }), /db down/);
  await assert.rejects(cache.get("k", () => { throw new Error("sync"); }), /sync/);
  assert.equal(await cache.get("k", async () => "ok"), "ok");
  assert.equal(cache.size(), 1);
});

test("at most 32 keys; the key stored longest ago is evicted first", async () => {
  const { reader, calls } = harness();
  for (let index = 0; index < PUBLIC_CATEGORY_CACHE_MAX_KEYS; index += 1) await reader.read(`city-${index}`);
  assert.equal(reader.size(), 32);
  await reader.read("city-32");
  assert.equal(reader.size(), 32);
  await reader.read("city-1"); // still cached
  assert.equal(calls.counts.length, 33);
  await reader.read("city-0"); // evicted, loads again
  assert.equal(calls.counts.length, 34);
});

test("catalog.showEmptyCategories is read on every call and is not part of the cached value", async () => {
  const { reader, calls, state } = harness({ showEmpty: true });
  assert.ok((await reader.read()).tree.some((node) => node.id === "empty"));
  state.showEmpty = false;
  assert.ok(!(await reader.read()).tree.some((node) => node.id === "empty"));
  assert.equal(calls.rows, 1);
  assert.equal(calls.setting, 2);
});

test("callers get their own rows array and counts map", async () => {
  const { reader } = harness();
  const first = await reader.read();
  first.rows.pop();
  first.counts.set("child", 999);
  const second = await reader.read();
  assert.equal(second.rows.length, 3);
  assert.equal(second.counts.get("child"), 3);
});
