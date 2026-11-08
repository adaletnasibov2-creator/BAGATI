import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isStoreAlreadyDeactivated, STORE_ARCHIVE_UPDATE } from "../lib/admin-store-archive";

test("store archive deactivates sales without deleting the store", () => {
  assert.deepEqual(STORE_ARCHIVE_UPDATE, { status: "SUSPENDED", isActive: false });
  assert.equal(isStoreAlreadyDeactivated("SUSPENDED", false), true);
  assert.equal(isStoreAlreadyDeactivated("ACTIVE", true), false);
  assert.equal(isStoreAlreadyDeactivated("SUSPENDED", true), false);
});

test("dedicated archive API requires ADMIN and records an auditable soft deactivation", () => {
  const routePath = resolve(dirname(fileURLToPath(import.meta.url)), "../app/api/admin/stores/[storeId]/archive/route.ts");
  const source = readFileSync(routePath, "utf8");
  assert.match(source, /const admin = await requireRole\("ADMIN"\)/);
  assert.match(source, /if \(!admin\)[\s\S]*?status: 403/);
  assert.match(source, /tx\.store\.updateMany\([\s\S]*?data: STORE_ARCHIVE_UPDATE/);
  assert.match(source, /STORE_DEACTIVATE_ARCHIVE/);
  assert.doesNotMatch(source, /\.store\.delete(?:Many)?\(/);
});
