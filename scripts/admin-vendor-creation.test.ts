import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendorRoute = readFileSync(resolve(root, "app/api/admin/vendors/route.ts"), "utf8");
const adminPage = readFileSync(resolve(root, "app/admin/[...section]/page.tsx"), "utf8");
const verificationPage = readFileSync(resolve(root, "app/admin/verification/page.tsx"), "utf8");
const validation = readFileSync(resolve(root, "lib/validation.ts"), "utf8");

test("admin vendor creation endpoint is ADMIN-only and validates on the server", () => {
  assert.match(vendorRoute, /const admin = await requireRole\("ADMIN"\)/);
  assert.match(vendorRoute, /if \(!admin\) return NextResponse\.json\(\{ error: "İcazə yoxdur" \}, \{ status: 403 \}\)/);
  assert.match(vendorRoute, /adminCreateVendorSchema\.safeParse\(data\)/);
  assert.match(validation, /export const adminCreateVendorSchema = z/);
  assert.match(validation, /\.superRefine\(/);
});

test("admin vendor creation hashes the password and never stores plaintext", () => {
  assert.match(vendorRoute, /import bcrypt from "bcryptjs"/);
  assert.match(vendorRoute, /const passwordHash = await bcrypt\.hash\(values\.password, 12\)/);
  assert.doesNotMatch(vendorRoute, /passwordHash:\s*values\.password/);
});

test("admin vendor creation rejects an existing email without creating a duplicate", () => {
  assert.match(vendorRoute, /const existing = await db\.user\.findUnique\(\{ where: \{ email \}, select: \{ id: true \} \}\)/);
  assert.match(vendorRoute, /if \(existing\) \{[\s\S]*?status: 409/);
  assert.match(vendorRoute, /isDuplicateEmailError\(error\)/);
});

test("admin vendor creation links User, VendorProfile and Store in one committed transaction", () => {
  assert.match(vendorRoute, /prisma\.\$transaction\(/);
  assert.match(vendorRoute, /tx\.user\.create\(\{[\s\S]*?role: "VENDOR"[\s\S]*?vendorProfile: \{[\s\S]*?create: \{/);
  assert.match(vendorRoute, /tx\.store\.create\(\{[\s\S]*?vendorId: vendorProfileId/);
  assert.match(vendorRoute, /TransactionIsolationLevel\.Serializable/);
  // A thrown error inside the transaction rolls back (no partial data persists).
  assert.match(vendorRoute, /if \(!vendorProfileId\) throw new Error\("VendorProfile could not be created"\)/);
});

test("admin vendor creation reuses the existing email verification outbox", () => {
  assert.match(vendorRoute, /enqueueVerificationEmail\(tx, \{/);
  assert.match(vendorRoute, /recipient: user\.email/);
  // No false delivery claim: the message is only enqueued, never asserted as sent.
  assert.doesNotMatch(vendorRoute, /e-poçt göndərildi/);
});

test("admin vendor creation keeps adminManaged subscription waiver and normal seller subscription rules", () => {
  assert.match(vendorRoute, /adminManaged: values\.adminManaged/);
  assert.match(vendorRoute, /managedByAdminId: values\.adminManaged \? admin\.id : null/);
  assert.match(vendorRoute, /subscriptionPaymentRequired: !values\.adminManaged/);
  // Store never auto-opens public selling: legal approval is off and initial activation is gated.
  assert.match(vendorRoute, /legalInfoApproved: false/);
  assert.match(vendorRoute, /status: values\.initialStatus/);
  assert.match(vendorRoute, /isActive: isActiveInitial/);
});

test("admin vendor creation records an audit log and an internal admin note", () => {
  assert.match(vendorRoute, /action: "ADMIN_VENDOR_CREATE"/);
  assert.match(vendorRoute, /internalNote: values\.internalNote \|\| null/);
});

test("admin UI exposes a vendors/new route with the full onboarding form", () => {
  assert.match(adminPage, /if\(route==="vendors\/new"\)/);
  assert.match(adminPage, /title="Satıcı hesabı yarat"/);
  assert.match(adminPage, /name:"firstName"/);
  assert.match(adminPage, /name:"lastName"/);
  assert.match(adminPage, /name:"email",label:"E-poçt",type:"email"/);
  assert.match(adminPage, /name:"password",label:"İlkin parol/);
  assert.match(adminPage, /name:"voen",label:"VÖEN"/);
  assert.match(adminPage, /name:"legalName"/);
  assert.match(adminPage, /name:"legalAddress"/);
  assert.match(adminPage, /name:"storeAddress"/);
  assert.match(adminPage, /name:"storeName"/);
  assert.match(adminPage, /name:"initialStatus"/);
  assert.match(adminPage, /name:"adminManaged"/);
  assert.match(adminPage, /name:"internalNote"/);
  // Category is intentionally not collected (categories attach to products, not stores).
  assert.doesNotMatch(adminPage, /name:"categoryId",label:"Kateqoriya"/);
});

test("admin verification links use the identifier expected by each account detail route", () => {
  assert.match(adminPage, /prisma\.vendorProfile\.findUnique\(\{[\s\S]*?where:\s*\{ id: vendorId \}/);
  assert.match(verificationPage, /vendorProfile:\s*\{\s*select:\s*\{\s*id:\s*true,\s*displayName:\s*true\s*\}/);
  assert.match(verificationPage, /role:\s*"vendor"[^}]*detailId:\s*user\.vendorProfile\?\.id/);
  assert.match(verificationPage, /role:\s*"customer"[^}]*detailId:\s*user\.id/);
  assert.match(verificationPage, /\/\$\{user\.role === "customer" \? "customers" : "vendors"\}\/\$\{user\.detailId\}/);
});


test("admin seller detail uses a bounded, schema-explicit query and handles missing optional data", () => {
  const branchStart = adminPage.indexOf('if (parts[0] === "vendors" && parts.length === 2)');
  const nextRoute = adminPage.indexOf('if(route==="customers")', branchStart);
  assert.ok(branchStart >= 0 && nextRoute > branchStart, "seller detail route should be present");
  const sellerDetail = adminPage.slice(branchStart, nextRoute);

  assert.match(adminPage.slice(0, branchStart), /requireRole\("ADMIN"\)/);
  assert.match(sellerDetail, /prisma\.vendorProfile\.findUnique/);
  assert.match(sellerDetail, /where:\s*\{ id: vendorId \}/);
  assert.match(sellerDetail, /if \(!vendor\) notFound\(\)/);
  assert.match(sellerDetail, /take:\s*50/);
  assert.match(sellerDetail, /subscription:\s*\{\s*select:/);
  assert.match(sellerDetail, /plan:\s*\{ select:\s*\{ name:\s*true \} \}/);
  assert.doesNotMatch(sellerDetail, /subscription:\s*\{\s*include:/);
  assert.match(sellerDetail, /r\.subscription \?/);
  assert.match(sellerDetail, /r\.city\?\.name \|\|/);
  assert.match(sellerDetail, /vendor\._count\.stores > vendor\.stores\.length/);
  assert.doesNotMatch(sellerDetail, /(?:db|prisma)\.store\.update|subscription\.update/);
  assert.doesNotMatch(sellerDetail, /catch\s*\{/);
});
