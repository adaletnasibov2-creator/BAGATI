import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { adminProductUpdateSchema, adminPromotionSchema, hasAdminPromotionConflict, inventoryQuantityAllowed } from "../lib/admin-product-management";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

test("admin product input validates discounts and bounded fields", () => {
  const valid = {
    name: "Məhsul",
    description: null,
    sku: "SKU-1",
    categoryId: null,
    brandId: null,
    price: 20,
    discountPrice: 15,
    images: [],
    quantity: 5,
    lowStockThreshold: 2,
    variants: [],
  };
  assert.equal(adminProductUpdateSchema.safeParse(valid).success, true);
  assert.equal(adminProductUpdateSchema.safeParse({ ...valid, discountPrice: 20 }).success, false);
  assert.equal(adminProductUpdateSchema.safeParse({ ...valid, quantity: -1 }).success, false);
  assert.equal(adminProductUpdateSchema.safeParse({ ...valid, unexpected: true }).success, false);
});

test("inventory edits cannot lower quantity beneath reservations", () => {
  assert.equal(inventoryQuantityAllowed(5, 5), true);
  assert.equal(inventoryQuantityAllowed(4, 5), false);
  assert.equal(inventoryQuantityAllowed(2.5, 1), false);
});

test("promotion input rejects invalid periods, duplicate products, and invalid discounts", () => {
  const valid = {
    storeId: "store-1",
    name: "Yay endirimi",
    description: null,
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: "2026-02-01T00:00:00.000Z",
    isActive: true,
    discountType: "PERCENT",
    discountValue: 10,
    productIds: ["product-1"],
  };
  assert.equal(adminPromotionSchema.safeParse(valid).success, true);
  assert.equal(adminPromotionSchema.safeParse({ ...valid, endsAt: valid.startsAt }).success, false);
  assert.equal(adminPromotionSchema.safeParse({ ...valid, discountValue: 100 }).success, false);
  assert.equal(adminPromotionSchema.safeParse({ ...valid, productIds: ["product-1", "product-1"] }).success, false);
});

test("promotion conflicts are limited to active, intersecting date windows", () => {
  const candidate = { startsAt: new Date("2026-01-10T00:00:00Z"), endsAt: new Date("2026-01-20T00:00:00Z"), isActive: true };
  assert.equal(hasAdminPromotionConflict(candidate, [{ startsAt: new Date("2026-01-15T00:00:00Z"), endsAt: new Date("2026-01-25T00:00:00Z"), isActive: true }]), true);
  assert.equal(hasAdminPromotionConflict(candidate, [{ startsAt: new Date("2026-01-20T00:00:00Z"), endsAt: new Date("2026-01-25T00:00:00Z"), isActive: true }]), false);
  assert.equal(hasAdminPromotionConflict(candidate, [{ startsAt: new Date("2026-01-15T00:00:00Z"), endsAt: new Date("2026-01-25T00:00:00Z"), isActive: false }]), false);
});

test("admin edit routes retain role checks, transactional writes, and audit records", () => {
  const productRoute = source("app/api/admin/products/[productId]/route.ts");
  const promotionRoute = source("app/api/admin/promotions/route.ts");
  assert.match(productRoute, /requireRole\("ADMIN"\)/);
  assert.match(productRoute, /inventoryAdjustment\.create/);
  assert.match(productRoute, /ADMIN_PRODUCT_UPDATE/);
  assert.match(promotionRoute, /requireRole\("ADMIN"\)/);
  assert.match(promotionRoute, /isolationLevel: Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(promotionRoute, /ADMIN_PROMOTION_(CREATE|UPDATE|DEACTIVATE)/);
});

test("admin product imports are bounded, store-scoped, audited, and transaction-safe", () => {
  const route = source("app/api/admin/stores/[storeId]/imports/route.ts");
  const storeOptions = source("app/api/admin/imports/stores/route.ts");
  const exportRoute = source("app/api/admin/products/export/route.ts");
  const importForm = source("components/admin-product-import.tsx");
  const wizard = source("components/vendor-import.tsx");

  assert.match(route, /requireRole\("ADMIN"\)/);
  assert.match(route, /MAX_REQUEST_BYTES/);
  assert.match(route, /rows: z\.array\(z\.record\(z\.string\(\)\.max\(20_000\)\)\)\.min\(1\)\.max\(1000\)/);
  assert.match(route, /updateMany\(\{\s*where: \{ id: row\.existingId, storeId \}/);
  assert.match(route, /reserved: \{ lte: value\.quantity \}/);
  assert.match(route, /status: "DRAFT"/);
  assert.match(route, /tx\.auditLog\.create/);
  assert.match(route, /isOwnedStoreAssetUrl/);
  for (const assetRoutePath of [
    "app/api/vendor/[storeId]/assets/route.ts",
    "app/api/admin/homepage/assets/route.ts",
  ]) {
    const assetRoute = source(assetRoutePath);
    assert.match(assetRoute, /readBoundedRequestBytes\(request, MAX_FORM_BYTES\)/);
    assert.ok(assetRoute.indexOf("readBoundedRequestBytes(request, MAX_FORM_BYTES)") < assetRoute.indexOf(").formData()"));
  }
  assert.match(route, /readBoundedRequestBytes\(request, MAX_REQUEST_BYTES\)/);
  assert.ok(route.indexOf("readBoundedRequestBytes(request, MAX_REQUEST_BYTES)") < route.indexOf("JSON.parse(raw)"));
  assert.match(storeOptions, /requireRole\("ADMIN"\)/);
  assert.match(storeOptions, /take: 25/);
  assert.match(exportRoute, /requireRole\("ADMIN"\)/);
  assert.match(exportRoute, /take: 250/);
  assert.match(exportRoute, /escapeAdminReportCsvCell/);
  assert.match(importForm, /\/api\/admin\/stores\/\$\{encodeURIComponent\(selected\.id\)\}\/imports/);
  assert.match(wizard, /CSV şablonunu yüklə/);
  assert.match(wizard, /Şəkillər/);
  assert.match(wizard, /Variantlar \(JSON\)/);
});
