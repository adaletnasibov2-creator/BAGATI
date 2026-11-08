import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyImportOutcomes,
  canAccessImportJob,
  canAppendImportRows,
  canProcessImportJob,
  duplicateImportRowNumbers,
  finalImportJobStatus,
  MAX_IMPORT_JOB_CHUNK_SIZE,
  normalizeImportJobChunkSize,
  normalizeImportSku,
  planImportRowAppend,
  retryImportFailures,
  shouldSkipExistingImportProduct,
} from "../lib/catalog-import-jobs";

test("job lifecycle allows staged upload, queued processing, pause, and terminal states", () => {
  assert.equal(canAppendImportRows("UPLOADING"), true);
  assert.equal(canAppendImportRows("QUEUED"), false);
  assert.equal(canProcessImportJob("QUEUED"), true);
  assert.equal(canProcessImportJob("PROCESSING"), true);
  assert.equal(canProcessImportJob("PAUSED"), false);
  assert.equal(finalImportJobStatus({
    totalRows: 3, processedRows: 2, createdRows: 2, updatedRows: 0, skippedRows: 0, failedRows: 0,
  }), "PROCESSING");
  assert.equal(finalImportJobStatus({
    totalRows: 3, processedRows: 3, createdRows: 2, updatedRows: 0, skippedRows: 0, failedRows: 1,
  }), "COMPLETED_WITH_ERRORS");
});

test("chunk size is bounded and defaulted", () => {
  assert.equal(normalizeImportJobChunkSize(undefined), 50);
  assert.equal(normalizeImportJobChunkSize(MAX_IMPORT_JOB_CHUNK_SIZE), 50);
  assert.throws(() => normalizeImportJobChunkSize(51), /INVALID_IMPORT_CHUNK_SIZE/);
  assert.throws(() => normalizeImportJobChunkSize(2), /INVALID_IMPORT_CHUNK_SIZE/);
});

test("row append supports exact replay without counting or inserting duplicates", () => {
  assert.deepEqual(planImportRowAppend({ currentTotal: 4, rowNumbers: [3, 4] }), {
    newRowNumbers: [],
    nextTotal: 4,
  });
  assert.deepEqual(planImportRowAppend({ currentTotal: 4, rowNumbers: [4, 5, 6] }), {
    newRowNumbers: [5, 6],
    nextTotal: 6,
  });
  assert.throws(() => planImportRowAppend({ currentTotal: 4, rowNumbers: [6, 7] }), /IMPORT_ROW_GAP/);
});

test("SKU duplicates are detected across staged chunks using normalized keys", () => {
  const firstSku = normalizeImportSku(" SKU-Ə1 ");
  assert.equal(firstSku, normalizeImportSku("sku-Ə1"));
  assert.deepEqual(
    [...duplicateImportRowNumbers(
      [{ rowNumber: 3, normalizedSku: firstSku }, { rowNumber: 4, normalizedSku: "sku-2" }],
      new Map([[firstSku!, 1]]),
    )],
    [3],
  );
});

test("retry SKU correction re-normalizes replacements and still detects staged collisions", () => {
  const correctedSku = normalizeImportSku("  ＳＫＵ-2 ");
  assert.equal(correctedSku, "sku-2");
  assert.deepEqual(
    [...duplicateImportRowNumbers([{ rowNumber: 8, normalizedSku: correctedSku }], new Map([["sku-1", 2]]))],
    [],
  );
  assert.deepEqual(
    [...duplicateImportRowNumbers([{ rowNumber: 8, normalizedSku: correctedSku }], new Map([["sku-2", 2]]))],
    [8],
  );
});

test("skip mode records existing SKUs without treating them as failures", () => {
  assert.equal(shouldSkipExistingImportProduct("skip", "update"), true);
  assert.equal(shouldSkipExistingImportProduct("skip", "create"), false);
  assert.equal(shouldSkipExistingImportProduct("mixed", "update"), false);
});

test("progress counters account for partial success and retries without double counting", () => {
  const initial = { totalRows: 4, processedRows: 0, createdRows: 0, updatedRows: 0, skippedRows: 0, failedRows: 0 };
  const processed = applyImportOutcomes(initial, ["CREATED", "UPDATED", "SKIPPED", "FAILED"]);
  assert.deepEqual(processed, {
    totalRows: 4, processedRows: 4, createdRows: 1, updatedRows: 1, skippedRows: 1, failedRows: 1,
  });
  const retried = retryImportFailures(processed, 1);
  assert.equal(retried.processedRows, 3);
  assert.equal(retried.failedRows, 0);
  assert.equal(finalImportJobStatus(retried), "PROCESSING");
  assert.throws(() => applyImportOutcomes(processed, ["CREATED"]), /IMPORT_PROGRESS_OVERFLOW/);
});

test("job access requires vendor role and matching owned store", () => {
  assert.equal(canAccessImportJob({ role: "VENDOR", storeId: "store-a", jobStoreId: "store-a" }), true);
  assert.equal(canAccessImportJob({ role: "VENDOR", storeId: "store-a", jobStoreId: "store-b" }), false);
  assert.equal(canAccessImportJob({ role: "ADMIN", storeId: "store-a", jobStoreId: "store-a" }), false);
});

test("job row locking is the concurrency boundary for a single active chunk", async () => {
  let active = 0;
  let maxActive = 0;
  let tail = Promise.resolve();
  const runLockedChunk = async () => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    release();
  };

  await Promise.all([runLockedChunk(), runLockedChunk(), runLockedChunk()]);
  assert.equal(maxActive, 1);
});

test("job routes scope jobs to the authenticated store and lock processing transactions", async () => {
  const rowsRoute = await readFile(new URL("../app/api/vendor/[storeId]/imports/jobs/[jobId]/rows/route.ts", import.meta.url), "utf8");
  const jobRoute = await readFile(new URL("../app/api/vendor/[storeId]/imports/jobs/[jobId]/route.ts", import.meta.url), "utf8");
  const processRoute = await readFile(new URL("../app/api/vendor/[storeId]/imports/jobs/[jobId]/process/route.ts", import.meta.url), "utf8");
  const entitlements = await readFile(new URL("../lib/subscription-entitlements.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");

  assert.match(processRoute, /requireStoreAccess\(storeId\)/);
  assert.match(rowsRoute, /requireStoreAccess\(storeId\)/);
  assert.match(rowsRoute, /readJsonBodyLimited\(request,/);
  assert.match(jobRoute, /readJsonBodyLimited\(request,/);
  assert.match(rowsRoute, /code: body\.error/);
  assert.match(jobRoute, /code: body\.error/);
  assert.doesNotMatch(rowsRoute, /request\.json\(\)/);
  assert.doesNotMatch(jobRoute, /request\.json\(\)/);
  assert.match(jobRoute, /normalizedSku,\s*status: "PENDING"/);
  assert.match(jobRoute, /ON CONFLICT \("jobId", "normalizedSku"\)/);
  assert.match(rowsRoute, /WHERE "id" = \$\{jobId\} AND "storeId" = \$\{access\.storeId\} FOR UPDATE/);
  assert.match(jobRoute, /where: \{ id: jobId, storeId: access\.storeId \}/);
  assert.match(jobRoute, /canAccessImportJob/);
  assert.match(processRoute, /lockStoreEntitlement\(tx, access\.storeId\)/);
  assert.match(entitlements, /SELECT "id" FROM "Store" WHERE "id" = \$\{storeId\} FOR UPDATE/);
  assert.match(processRoute, /SELECT "id" FROM "ImportJob" WHERE "id" = \$\{jobId\} AND "storeId" = \$\{access\.storeId\} FOR UPDATE/);
  assert.match(processRoute, /take: job\.chunkSize/);
  assert.match(processRoute, /withImportPersistenceSavepoint\(tx/);
  assert.match(processRoute, /findExistingProductSkuMatches/);
  assert.match(processRoute, /findExistingVariantSkuKeys/);
  assert.match(processRoute, /if \(!persisted\.ok\)/);
  assert.match(processRoute, /status: "FAILED" as const/);
  assert.match(schema, /@@unique\(\[jobId, rowNumber\]\)/);
  assert.match(schema, /@@unique\(\[jobId, normalizedSku\]\)/);
});

test("migration is additive and introduces only job, row, and SKU-registry objects", async () => {
  const migration = await readFile(new URL("../prisma/migrations/20261106020000_catalog_import_jobs/migration.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE "ImportJob"/);
  assert.match(migration, /CREATE TABLE "ImportJobRow"/);
  assert.match(migration, /CREATE TABLE "ImportJobSku"/);
  assert.match(migration, /FOREIGN KEY \("storeId"\) REFERENCES "Store"\("id"\) ON DELETE CASCADE/);
  assert.doesNotMatch(migration, /^\s*(UPDATE|DELETE FROM|DROP TABLE|DROP TYPE|TRUNCATE)\b/im);
});

test("canonical SKU migration preflights existing conflicts and adds only unique expression indexes", async () => {
  const migration = await readFile(new URL("../prisma/migrations/20261106030000_canonical_sku_uniqueness/migration.sql", import.meta.url), "utf8");
  assert.match(migration, /GROUP BY "storeId", \(translate\(btrim\(normalize\("sku", NFKC\)/);
  assert.match(migration, /GROUP BY \(translate\(btrim\(normalize\("sku", NFKC\)/);
  assert.match(migration, /CREATE UNIQUE INDEX "Product_storeId_sku_canonical_key"/);
  assert.match(migration, /CREATE UNIQUE INDEX "ProductVariant_sku_canonical_key"/);
  assert.doesNotMatch(migration, /lower\s*\(/i);
  assert.doesNotMatch(migration, /^\s*(UPDATE|DELETE FROM|DROP TABLE|DROP TYPE|TRUNCATE)\b/im);
});

test("staging compares replay payloads and enforces a pre-parse request byte cap", async () => {
  const rowsRoute = await readFile(new URL("../app/api/vendor/[storeId]/imports/jobs/[jobId]/rows/route.ts", import.meta.url), "utf8");
  const jobRoute = await readFile(new URL("../app/api/vendor/[storeId]/imports/jobs/[jobId]/route.ts", import.meta.url), "utf8");
  assert.match(rowsRoute, /readJsonBodyLimited\(request, MAX_STAGING_REQUEST_BYTES\)/);
  assert.match(rowsRoute, /sameJsonValue/);
  assert.match(rowsRoute, /ROW_REPLAY_CONFLICT/);
  assert.match(jobRoute, /readJsonBodyLimited\(request, MAX_RETRY_REQUEST_BYTES\)/);
});
