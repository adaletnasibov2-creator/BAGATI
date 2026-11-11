import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { vendorNotificationScope } from "../lib/vendor-notifications.ts";
import { parseVendorOrderSearch, summarizePaymentStatus, vendorOrderWhere } from "../lib/vendor-order-search.ts";

test("notification scope always pins the signed-in seller and this store (or account-wide rows)", () => {
  const where = vendorNotificationScope("seller-a", "store-a");
  assert.equal(where.userId, "seller-a");
  assert.deepEqual(where.OR, [{ storeId: "store-a" }, { storeId: null }]);
});

test("targeting another seller's notification id cannot drop the owner condition", () => {
  const where = vendorNotificationScope("seller-a", "store-a", { id: "notification-of-seller-b", unreadOnly: true });
  assert.equal(where.userId, "seller-a", "an id narrows the scope; it never replaces the owner");
  assert.equal(where.id, "notification-of-seller-b");
  assert.equal(where.readAt, null);
  assert.deepEqual(where.OR, [{ storeId: "store-a" }, { storeId: null }]);
});

test("notification scope refuses to build without a seller and store", () => {
  assert.throws(() => vendorNotificationScope("", "store-a"), /VENDOR_SCOPE_REQUIRED/);
  assert.throws(() => vendorNotificationScope("seller-a", ""), /VENDOR_SCOPE_REQUIRED/);
});

test("order search is always confined to the server-resolved store", () => {
  for (const q of [null, "", "#A1B2C3D4", "Köynək", "storeId", '{"storeId":"store-b"}', "x".repeat(500)]) {
    const where = vendorOrderWhere("store-a", "NEW", q);
    assert.equal(where.storeId, "store-a", `q=${String(q).slice(0, 20)}`);
    assert.equal(where.status, "NEW");
    if (where.AND) for (const clause of where.AND) assert.equal("storeId" in clause, false, "search clauses never set storeId");
  }
  assert.throws(() => vendorOrderWhere("", null, "abc"), /VENDOR_SCOPE_REQUIRED/);
});

test("order search accepts the visible short reference and bounds input length", () => {
  const parsed = parseVendorOrderSearch("  #a1b2c3d4 ");
  assert.equal(parsed.OR[0].order.id.contains, "a1b2c3d4");
  assert.equal(parsed.OR[0].order.id.mode, "insensitive");
  assert.equal(parseVendorOrderSearch("a"), null);
  assert.equal(parseVendorOrderSearch("x".repeat(500)).OR[2].items.some.productName.contains.length, 80);
});

test("payment summary reports the real payment state, never assuming payment", () => {
  assert.deepEqual(summarizePaymentStatus([]), { status: null, label: "Ödəniş qeydi yoxdur" });
  assert.equal(summarizePaymentStatus(["FAILED", "PENDING"]).status, "PENDING");
  assert.equal(summarizePaymentStatus(["PENDING", "PAID"]).status, "PAID");
  assert.equal(summarizePaymentStatus(["PAID", "REFUNDED"]).status, "REFUNDED");
});

// Static regression guards on the seller API: every verb resolves ownership on the server first.
const route = readFileSync(new URL("../app/api/vendor/[storeId]/[section]/route.ts", import.meta.url), "utf8");

test("seller section API resolves store ownership before any verb runs", () => {
  assert.match(route, /async function scope\(storeId:string\)\{const access=await requireStoreAccess\(storeId\);return access\?\.user\.role==="VENDOR"\?access:null\}/);
  for (const verb of ["GET", "POST", "PATCH"]) {
    const start = route.indexOf(`export async function ${verb}(`);
    assert.ok(start >= 0, `${verb} handler exists`);
    const head = route.slice(start, start + 400);
    assert.match(head, /const access=await scope\(storeId\);\s*if\(!access\)return NextResponse\.json\(\{error:"Mağazaya giriş icazəsi yoxdur"\},\{status:403\}\)/, `${verb} rejects non-owners with 403`);
  }
});

test("seller notification and order queries use the scoped builders", () => {
  assert.match(route, /vendorNotificationScope\(access\.user\.id,storeId,\{unreadOnly:true,id:targetId\}\)/);
  assert.match(route, /const where=vendorOrderWhere\(storeId,status,/);
  assert.doesNotMatch(route, /notification\.(updateMany|findMany|count)\(\{where:\{(?!.*vendorNotificationScope)[^}]*\}\}\)/);
});

test("seller order detail no longer loads the customer's e-mail address", () => {
  const page = readFileSync(new URL("../app/vendor/[storeId]/orders/[storeOrderId]/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /email/);
  assert.match(page, /storeId/);
});
