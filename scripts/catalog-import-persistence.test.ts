import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import type { ImportRowCheck } from "../lib/product-import";
import {
  failedChunkRowOutcomes,
  persistCatalogImportChunk,
  withImportPersistenceSavepoint,
} from "../lib/catalog-import-persistence";
import { applyImportOutcomes, retryImportFailures } from "../lib/catalog-import-jobs";

function row(index: number, sku: string, action: "create" | "update", existingId?: string): ImportRowCheck {
  return {
    index,
    status: "VALID",
    errors: [],
    warnings: [],
    action,
    existingId,
    product: {
      name: `Product ${index}`,
      sku,
      description: "seller supplied description",
      price: 12.5,
      discountPrice: null,
      categoryId: "category-a",
      brandId: null,
      quantity: 8,
      lowStockThreshold: 3,
      variants: [],
      images: [],
    },
  };
}

test("product and inventory creates use bounded bulk writes for a chunk", async () => {
  const calls: string[] = [];
  const tx = {
    product: { createMany: async ({ data }: { data: unknown[] }) => { calls.push(`products:${data.length}`); return { count: data.length }; } },
    productVariant: { createMany: async () => { calls.push("variants"); return { count: 0 }; } },
    inventory: {
      findMany: async () => [],
      createMany: async ({ data }: { data: unknown[] }) => { calls.push(`inventory:${data.length}`); return { count: data.length }; },
    },
    inventoryAdjustment: { createMany: async () => ({ count: 0 }) },
    $executeRaw: async () => { calls.push("raw"); return 0; },
  };

  const result = await persistCatalogImportChunk({
    tx: tx as unknown as Prisma.TransactionClient,
    storeId: "store-a",
    actorUserId: "vendor-a",
    rows: [row(1, "SKU-1", "create"), row(2, "SKU-2", "create")],
  });

  assert.equal(result.created, 2);
  assert.equal(result.updated, 0);
  assert.equal(result.productIds.size, 2);
  assert.deepEqual(calls, ["products:2", "inventory:2"]);
});

test("heterogeneous product and inventory updates are applied in bulk parameterized statements", async () => {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const tx = {
    product: { createMany: async () => ({ count: 0 }) },
    productVariant: { createMany: async () => ({ count: 0 }) },
    inventory: {
      findMany: async () => [
        { id: "inventory-1", productId: "product-1", quantity: 4, reserved: 1, lowStockThreshold: 2 },
        { id: "inventory-2", productId: "product-2", quantity: 5, reserved: 1, lowStockThreshold: 2 },
      ],
      createMany: async () => ({ count: 0 }),
    },
    inventoryAdjustment: { createMany: async ({ data }: { data: unknown[] }) => ({ count: data.length }) },
    $executeRaw: async (query: { sql: string; values: unknown[] }) => {
      statements.push(query);
      return 2;
    },
  };

  const result = await persistCatalogImportChunk({
    tx: tx as unknown as Prisma.TransactionClient,
    storeId: "store-a",
    actorUserId: "vendor-a",
    rows: [
      row(1, "SKU-1", "update", "product-1"),
      row(2, "SKU-2", "update", "product-2"),
    ],
  });

  assert.equal(result.updated, 2);
  assert.equal(statements.length, 2);
  assert.match(statements[0].sql, /UPDATE "Product"/);
  assert.match(statements[1].sql, /UPDATE "Inventory"/);
  assert.ok(!statements[0].sql.includes("seller supplied description"));
  assert.equal(statements[0].values.includes("seller supplied description"), true);
});

test("inventory threshold updates are persisted even when quantity is unchanged", async () => {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  let adjustmentWrites = 0;
  const tx = {
    product: { createMany: async () => ({ count: 0 }) },
    productVariant: { createMany: async () => ({ count: 0 }) },
    inventory: {
      findMany: async () => [
        { id: "inventory-1", productId: "product-1", quantity: 8, reserved: 1, lowStockThreshold: 2 },
      ],
      createMany: async () => ({ count: 0 }),
    },
    inventoryAdjustment: { createMany: async () => { adjustmentWrites++; return { count: 0 }; } },
    $executeRaw: async (query: { sql: string; values: unknown[] }) => {
      statements.push(query);
      return 1;
    },
  };

  await persistCatalogImportChunk({
    tx: tx as unknown as Prisma.TransactionClient,
    storeId: "store-a",
    actorUserId: "vendor-a",
    rows: [row(1, "SKU-1", "update", "product-1")],
  });

  assert.equal(statements.length, 2);
  assert.match(statements[1].sql, /UPDATE "Inventory"/);
  assert.equal(adjustmentWrites, 0);
});

test("a failed atomic persistence attempt rolls back to its savepoint and can be retried", async () => {
  const statements: string[] = [];
  const tx = {
    $executeRaw: async (strings: TemplateStringsArray) => {
      statements.push(strings.join("").trim());
      return 0;
    },
  };
  const failed = await withImportPersistenceSavepoint(
    tx as unknown as Prisma.TransactionClient,
    async () => { throw new Error("simulated unique constraint violation"); },
  );
  assert.equal(failed.ok, false);
  assert.deepEqual(statements, [
    "SAVEPOINT catalog_import_persistence",
    "ROLLBACK TO SAVEPOINT catalog_import_persistence",
    "RELEASE SAVEPOINT catalog_import_persistence",
  ]);

  const retried = await withImportPersistenceSavepoint(
    tx as unknown as Prisma.TransactionClient,
    async () => ({ created: 1 }),
  );
  assert.deepEqual(retried, { ok: true, value: { created: 1 } });
  assert.deepEqual(statements.slice(3), [
    "SAVEPOINT catalog_import_persistence",
    "RELEASE SAVEPOINT catalog_import_persistence",
  ]);
});

test("rolled-back chunk diagnostics are persisted per row and retry counters remain accurate", () => {
  const sourceRows = [
    { index: 1, errors: [] },
    { index: 2, errors: ["Original validation warning"] },
  ];
  const failed = failedChunkRowOutcomes(sourceRows, "Chunk rollback; no catalog writes committed.");
  assert.deepEqual(failed.map((row) => row.errors), [
    ["Chunk rollback; no catalog writes committed."],
    ["Original validation warning", "Chunk rollback; no catalog writes committed."],
  ]);
  assert.ok(failed.every((row) => row.status === "FAILED" && row.productId === null));

  const initial = { totalRows: 2, processedRows: 0, createdRows: 0, updatedRows: 0, skippedRows: 0, failedRows: 0 };
  const afterRollback = applyImportOutcomes(initial, ["FAILED", "FAILED"]);
  assert.deepEqual(afterRollback, { ...initial, processedRows: 2, failedRows: 2 });
  const retrying = retryImportFailures(afterRollback, 2);
  assert.deepEqual(retrying, initial);
  const afterCorrectedRetry = applyImportOutcomes(retrying, ["CREATED", "UPDATED"]);
  assert.deepEqual(afterCorrectedRetry, {
    totalRows: 2, processedRows: 2, createdRows: 1, updatedRows: 1, skippedRows: 0, failedRows: 0,
  });
});
