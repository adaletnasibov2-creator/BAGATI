import assert from "node:assert/strict";
import test from "node:test";
import { catalogImportRetentionDays } from "../lib/catalog-import-retention";

test("import retention periods are configurable with bounded safe defaults", () => {
  assert.deepEqual(catalogImportRetentionDays({}), { completed: 90, failed: 180, cancelled: 30 });
  assert.deepEqual(catalogImportRetentionDays({
    CATALOG_IMPORT_COMPLETED_RETENTION_DAYS: "45",
    CATALOG_IMPORT_FAILED_RETENTION_DAYS: "365",
    CATALOG_IMPORT_CANCELLED_RETENTION_DAYS: "7",
  }), { completed: 45, failed: 365, cancelled: 7 });
  assert.deepEqual(catalogImportRetentionDays({
    CATALOG_IMPORT_COMPLETED_RETENTION_DAYS: "0",
    CATALOG_IMPORT_FAILED_RETENTION_DAYS: "NaN",
    CATALOG_IMPORT_CANCELLED_RETENTION_DAYS: "99999",
  }), { completed: 90, failed: 180, cancelled: 30 });
});
