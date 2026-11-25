/**
 * CLEANUP-1: small cleanup after SECURITY-AUDIT-1.
 *  1. .gitattributes keeps every *.sql file LF (also in Windows working copies).
 *  2. Stock history: every InventoryAdjustment write records the acting user (column is required; every write passes it).
 *  3. Profile phone: same Azerbaijani mobile validator as orders, stored as +994XXXXXXXXX, empty still allowed,
 *     existing error text.
 *  4. The unreachable legacy [section] branches (GET/POST campaigns, PATCH products) are gone, and the dedicated routes
 *     that shadow those paths still exist.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { profilePhoneInput } from "../lib/profile-phone";
import { AZ_PHONE_ERROR, normalizeAzMobilePhone } from "../lib/az-phone";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
function sourceFiles(dir: string, out: string[] = []) {
  for (const name of readdirSync(join(root, dir))) {
    const path = `${dir}/${name}`;
    if (statSync(join(root, path)).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

test("1: .gitattributes keeps SQL files LF", () => {
  assert.match(read(".gitattributes"), /^\*\.sql text eol=lf$/m);
});

test("2: InventoryAdjustment.actorUserId is required and linked to a user", () => {
  const model = read("prisma/schema.prisma").match(/model InventoryAdjustment \{([^}]*)\}/)![1];
  assert.match(model, /\n\s*actorUserId\s+String\s*\n/, "required (not String?)");
  assert.match(model, /actor\s+User\s+@relation\(fields: \[actorUserId\], references: \[id\]\)/);
});

test("2: every stock-history write passes the acting user", () => {
  const writes: string[] = [];
  for (const file of [...sourceFiles("app"), ...sourceFiles("lib")]) {
    const text = read(file);
    for (const match of text.matchAll(/inventoryAdjustment\.(create|createMany)\(/g)) {
      const call = text.slice(match.index!, match.index! + 700);
      writes.push(file);
      // createMany with rows built earlier: the row builder in the same file must set the actor from the caller.
      const ok = /actorUserId\s*[:,]/.test(call) || (match[1] === "createMany" && /actorUserId:\s*input\.actorUserId/.test(text));
      assert.ok(ok, `${file}: inventoryAdjustment.${match[1]} without actorUserId`);
      assert.doesNotMatch(call.slice(0, 400), /actorUserId:\s*(null|undefined|""|'')/, `${file}: empty actor`);
    }
  }
  // The known write paths: seller edit/import/returns, checkout, store-order cancel, admin edit/import, catalog import.
  for (const file of ["app/api/orders/route.ts", "lib/order-fulfillment.ts", "app/api/vendor/[storeId]/returns/route.ts", "lib/vendor-product-patch.ts",
    "app/api/vendor/[storeId]/products/route.ts", "app/api/vendor/[storeId]/[section]/route.ts", "app/api/admin/products/[productId]/route.ts",
    "app/api/admin/stores/[storeId]/imports/route.ts", "lib/catalog-import-persistence.ts"]) assert.ok(writes.includes(file), file);
});

test("3: profile phone uses the order validator; empty allowed; stored like orders; others refused", () => {
  assert.equal(profilePhoneInput(undefined), undefined);
  assert.equal(profilePhoneInput(""), "");
  assert.equal(profilePhoneInput("   "), "");
  for (const value of ["055 123 45 67", "+994 50 123 45 67", "0501234567", "+994551234567"]) {
    assert.equal(profilePhoneInput(value), normalizeAzMobilePhone(value), value);
    assert.match(profilePhoneInput(value)!, /^\+994\d{9}$/, value);
  }
  for (const value of ["012 123 45 67", "+994121234567", "abc", "123", "+7 999 123 45 67"]) assert.equal(profilePhoneInput(value), null, value);
});

test("3: PATCH /api/account/profile refuses an invalid phone with the existing message and saves the normalised one", () => {
  const route = read("app/api/account/profile/route.ts");
  const patch = route.slice(route.indexOf("export async function PATCH"));
  assert.match(patch, /const phone = profilePhoneInput\(parsed\.data\.phone\);/);
  assert.match(patch, /if \(phone === null\) return NextResponse\.json\(\{ error: AZ_PHONE_ERROR, code: "PHONE_INVALID" \}, \{ status: 400 \}\);/);
  assert.match(patch, /issue\.path\[0\] === "phone"\)\) return NextResponse\.json\(\{ error: AZ_PHONE_ERROR, code: "PHONE_INVALID" \}/);
  assert.match(patch, /const data = \{ firstName: parsed\.data\.firstName, lastName: parsed\.data\.lastName, \.\.\.\(phone !== undefined \? \{ phone \} : \{\}\) \};/);
  assert.match(patch, /upsert\(\{ where: \{ userId: user\.id \}, create: \{ userId: user\.id, \.\.\.data \}, update: data \}\)/);
  assert.doesNotMatch(patch, /\.\.\.parsed\.data\b/, "the raw phone is never written");
  assert.ok(patch.indexOf("profilePhoneInput(") < patch.indexOf("customerProfile.upsert("));
  // The existing text (addresses / orders), no new wording.
  assert.equal(AZ_PHONE_ERROR, "Telefon nömrəsini Azərbaycan formatında yazın, məsələn +994 55 123 45 67 və ya 055 123 45 67.");
  assert.match(read("app/api/account/addresses/route.ts"), /error: AZ_PHONE_ERROR, code: "PHONE_INVALID"/);
});

test("4: the unreachable legacy [section] branches are gone and the dedicated routes still take those paths", () => {
  const section = read("app/api/vendor/[storeId]/[section]/route.ts");
  assert.doesNotMatch(section, /section==="campaigns"|section==="products"/);
  assert.doesNotMatch(section, /legacyVendorProductPatchSchema|hasOverlappingEnabledPromotion|isVendorProductActivation/);
  // Sections that have no dedicated route keep their [section] branches.
  for (const name of ["imports", "orders", "inventory", "profile", "reviews", "notifications", "sales", "settings", "subscription", "submit"]) assert.match(section, new RegExp(`section==="${name}"`), name);
  // A dedicated route.ts takes its whole path (all methods): campaigns serves GET/POST, products serves GET/POST and
  // answers 405 to PATCH (seen live in SECURITY-AUDIT-1).
  const campaigns = read("app/api/vendor/[storeId]/campaigns/route.ts"), products = read("app/api/vendor/[storeId]/products/route.ts");
  assert.match(campaigns, /export async function GET\(/);
  assert.match(campaigns, /export async function POST\(/);
  assert.match(products, /export async function GET\(/);
  assert.match(products, /export async function POST\(/);
  assert.doesNotMatch(products, /export (async function|const) PATCH\b/);
});
