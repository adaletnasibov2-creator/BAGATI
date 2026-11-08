import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { collectStockFilteredPage } from "../lib/vendor-product-stock-page";

type Product = {
  id: string;
  createdAt: Date;
  lowStock: boolean;
};

test("stock-filtered product paging scans bounded batches and returns an exact page and count", async () => {
  const products: Product[] = Array.from({ length: 11 }, (_, index) => ({
    id: `product-${index + 1}`,
    createdAt: new Date(Date.UTC(2026, 0, 11 - index)),
    lowStock: index % 2 === 0,
  }));
  const cursors: string[] = [];
  const result = await collectStockFilteredPage({
    page: 2,
    pageSize: 2,
    batchSize: 3,
    loadBatch: async (cursor) => {
      cursors.push(cursor?.id ?? "start");
      const start = cursor ? products.findIndex((product) => product.id === cursor.id) + 1 : 0;
      return products.slice(start, start + 3);
    },
    matches: (product) => product.lowStock,
  });

  assert.deepEqual(result.items.map((product) => product.id), ["product-5", "product-7"]);
  assert.equal(result.page, 2);
  assert.equal(result.total, 6);
  assert.deepEqual(cursors, ["start", "product-3", "product-6", "product-9"]);
});

test("stock-filtered product paging handles empty and out-of-range pages", async () => {
  const result = await collectStockFilteredPage({
    page: 4,
    pageSize: 2,
    batchSize: 2,
    loadBatch: async (cursor) => {
      const products: Product[] = [
        { id: "product-1", createdAt: new Date("2026-01-03T00:00:00Z"), lowStock: true },
        { id: "product-2", createdAt: new Date("2026-01-02T00:00:00Z"), lowStock: true },
        { id: "product-3", createdAt: new Date("2026-01-01T00:00:00Z"), lowStock: false },
      ];
      const start = cursor ? products.findIndex((product) => product.id === cursor.id) + 1 : 0;
      return products.slice(start, start + 2);
    },
    matches: (product) => product.lowStock,
  });

  assert.deepEqual(result.items.map((product) => product.id), ["product-1", "product-2"]);
  assert.equal(result.page, 1);
  assert.equal(result.total, 2);

  const empty = await collectStockFilteredPage({
    page: 1,
    pageSize: 24,
    batchSize: 2,
    loadBatch: async () => [],
    matches: () => true,
  });
  assert.deepEqual(empty, { items: [], page: 1, total: 0 });
});

test("vendor product stock filters use bounded, deterministic keyset queries", async () => {
  const route = await readFile(new URL("../app/api/vendor/[storeId]/products/route.ts", import.meta.url), "utf8");

  assert.match(route, /collectStockFilteredPage/);
  assert.match(route, /batchSize:\s*250/);
  assert.match(route, /take:\s*250/);
  assert.match(route, /orderBy:\s*\[\{\s*createdAt:\s*"desc"\s*\},\s*\{\s*id:\s*"desc"\s*\}\]/);
  assert.match(route, /createdAt:\s*\{\s*lt:\s*cursor\.createdAt\s*\}/);
  assert.match(route, /id:\s*\{\s*lt:\s*cursor\.id\s*\}/);
  assert.match(route, /total,\s*page,\s*pages:/);
});
