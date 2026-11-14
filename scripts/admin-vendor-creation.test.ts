import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { adminSectionSource } from "./admin-section-source";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendorRoute = readFileSync(resolve(root, "app/api/admin/vendors/route.ts"), "utf8");
const adminPage = adminSectionSource();
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

test("admin vendor creation records an APPROVED seller application with source ADMIN in the same transaction", () => {
  const transaction = vendorRoute.slice(vendorRoute.indexOf("prisma.$transaction("), vendorRoute.indexOf("TransactionIsolationLevel.Serializable"));
  assert.match(transaction, /const application = await recordAdminCreatedSeller\(tx, \{[\s\S]*?vendorProfileId,[\s\S]*?adminId: admin\.id,/);
  assert.match(transaction, /vendorApplicationId: application\.id/);
  const service = readFileSync(resolve(root, "lib/seller-application-service.ts"), "utf8");
  const helper = service.slice(service.indexOf("export async function recordAdminCreatedSeller"));
  assert.match(helper, /status: "APPROVED",\s+source: "ADMIN",/);
  assert.match(helper, /voenNormalized: normalizeVoen\(input\.voen\)/);
  assert.match(helper, /reviewedById: input\.adminId,\s+reviewedAt: input\.now,/);
  // No openUserId: an APPROVED row is never "open" (the database CHECK requires NULL).
  // End of the helper = the first closing brace on its own line; works with LF and CRLF working copies.
  const helperEnd = helper.search(/\r?\n\}\r?\n/);
  assert.ok(helperEnd > 0, "helper end found");
  assert.doesNotMatch(helper.slice(0, helperEnd), /openUserId/);
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
  // Label now states the 10-digit rule (follow-up); the field itself is unchanged.
  assert.match(adminPage, /name:"voen",label:"VÖEN \(10 rəqəm\)",required:true/);
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

test("admin-created sellers need the same 10-digit VÖEN as customer applications", async () => {
  // Follow-up change: the schema used to accept any 3–32 characters (voen: z.string().trim().min(3).max(32)).
  // New admin-created sellers now use newVoenSchema from lib/seller-application.ts, the rule for SELF applications.
  // Older sellers keep their stored value: only new input is validated (ADMIN/LEGACY rows stay exempt in the database).
  const { adminCreateVendorSchema } = await import("../lib/validation");
  const base = {
    firstName: "Aysel", lastName: "Satıcı", email: "seller@example.test", password: "x".repeat(16),
    sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: "Aysel Satıcı", storeName: "Aysel Store", cityId: "city-1",
  };
  const parsed = adminCreateVendorSchema.parse({ ...base, voen: "12 345-678 90" });
  assert.equal(parsed.voen, "1234567890", "stored as digits only");
  for (const voen of ["123", "123456789", "12345678901", "AZ-123", ""]) {
    const result = adminCreateVendorSchema.safeParse({ ...base, voen });
    assert.equal(result.success, false, voen);
    assert.ok(result.error?.issues.some((issue) => issue.path.includes("voen")), voen);
  }
  const validation = readFileSync(resolve(root, "lib/validation.ts"), "utf8");
  assert.match(validation, /voen: newVoenSchema,/);
  assert.doesNotMatch(validation, /voen: z\.string\(\)\.trim\(\)\.min\(3\)\.max\(32\)/);
  assert.match(vendorRoute, /issue\.path\.includes\("voen"\)\) \? SELLER_APPLICATION_MESSAGES\.voen/);
});
