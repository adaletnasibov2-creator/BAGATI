import assert from "node:assert/strict";
import test from "node:test";
import { isValidVoen, maskVoenDigits, parseVoen, VOEN_HELP, VOEN_MESSAGES, voenKindLabel } from "../lib/voen";

test("valid: 10 ASCII digits ending in 1 (legal entity) or 2 (natural person)", () => {
  assert.deepEqual(parseVoen("1234567891"), { ok: true, voen: "1234567891", kind: "LEGAL_ENTITY" });
  assert.deepEqual(parseVoen("9876543212"), { ok: true, voen: "9876543212", kind: "NATURAL_PERSON" });
  assert.equal(voenKindLabel("LEGAL_ENTITY"), "Hüquqi şəxs");
  assert.equal(voenKindLabel("NATURAL_PERSON"), "Fiziki şəxs / fərdi sahibkar");
});

test("spaces of any kind are removed (incl. tab, no-break, zero-width, BOM, around and inside)", () => {
  for (const input of [" 1234567891 ", "12 345 678 91", "123\t456\n7891", "1234 567891", "1234 567891", "﻿1234567891", "1234​567891", "1234　567891"]) {
    assert.deepEqual(parseVoen(input), { ok: true, voen: "1234567891", kind: "LEGAL_ENTITY" }, JSON.stringify(input));
  }
});

test("invalid: empty, wrong characters, non-ASCII digits, wrong length, wrong last digit", () => {
  const code = (input: unknown) => { const result = parseVoen(input); return result.ok ? "OK" : result.code; };
  for (const input of [undefined, null, 1234567891, "", "   ", " \t﻿"]) assert.equal(code(input), "EMPTY", JSON.stringify(input));
  for (const input of ["12-345-678-91", "AZ12345678", "1234567891a", "123456789.1", "+1234567891", "１２３４５６７８９１", "١٢٣٤٥٦٧٨٩١", "۱۲۳۴۵۶۷۸۹۱", "१२३४५६७८९१"]) {
    assert.equal(code(input), "CHARACTERS", input);
  }
  for (const input of ["123456789", "12345678911", "1", "123456789012"]) assert.equal(code(input), "LENGTH", input);
  for (const input of ["1234567890", "1234567893", "1234567899", "0000000000"]) assert.equal(code(input), "LAST_DIGIT", input);
  assert.equal(isValidVoen("1234567890"), false);
  assert.equal(isValidVoen("1234567892"), true);
});

test("messages are Azerbaijani and never claim the number is registered", () => {
  assert.equal(VOEN_MESSAGES.LENGTH, "VÖEN 10 rəqəmdən ibarət olmalıdır.");
  assert.match(VOEN_MESSAGES.LAST_DIGIT, /sonuncu rəqəmi 1 \(hüquqi şəxs\) və ya 2 \(fiziki şəxs \/ fərdi sahibkar\)/);
  assert.match(VOEN_HELP, /^10 rəqəm, sonuncu rəqəm 1 və ya 2\./);
  for (const text of [...Object.values(VOEN_MESSAGES), VOEN_HELP]) assert.doesNotMatch(text, /etibarlı|həqiqi|real|mövcud/i);
});

test("masking keeps only the last three digits", () => {
  assert.equal(maskVoenDigits("1234567891"), "•••••••891");
  assert.equal(maskVoenDigits(null), "—");
});

test("every server path that accepts a VÖEN uses lib/voen.ts", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8").replace(/\r\n/g, "\n");
  // Customer applications and admin-created sellers share newVoenSchema.
  assert.match(read("lib/seller-application.ts"), /export const newVoenSchema = z\.string\(\)\.max\(40\)\.transform\(\(value, context\) => \{\n\s*const parsed = parseVoen\(value\);/);
  assert.match(read("lib/seller-application.ts"), /  voen: newVoenSchema,/);
  assert.match(read("lib/validation.ts"), /    voen: newVoenSchema,/);
  // The seller's own profile editor: checked when the VÖEN changes, stored as digits.
  const vendor = read("app/api/vendor/[storeId]/[section]/route.ts");
  assert.match(vendor, /const parsedVoen=parseVoen\(d\.voen\);if\(!parsedVoen\.ok\)return NextResponse\.json\(\{error:parsedVoen\.error,field:"voen"\},\{status:422\}\);d\.voen=parsedVoen\.voen;/);
  assert.ok(vendor.indexOf("parseVoen(d.voen)") < vendor.indexOf("const legalPatch="), "checked before anything is written");
});

test("one VÖEN per seller account: every writer locks and checks inside its transaction; no admin override", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8").replace(/\r\n/g, "\n");
  const uniqueness = read("lib/voen-uniqueness.ts");
  assert.match(uniqueness, /pg_advisory_xact_lock\(hashtext\(\$\{`bagati:voen:\$\{voenDigits\}`\}\)\)/);
  assert.match(uniqueness, /WHERE p\."userId" <> \$\{input\.userId\}[\s\S]*regexp_replace\(p\."voen", '\[\^0-9\]', '', 'g'\) = \$\{input\.voenNormalized\}/, "other users' profiles, older values compared as digits");
  assert.match(uniqueness, /status: "PENDING", id: \{ not: input\.applicationId \}, userId: \{ not: input\.userId \}/, "other users' open applications");
  const service = read("lib/seller-application-service.ts");
  assert.match(service, /if \(voenDigits && !await claimVoenForUser\(tx, \{ voenDigits, userId: input\.userId \}\)\) throw new SellerApplicationError\("DUPLICATE_VOEN"\);/);
  assert.match(service, /if \(application\.voenNormalized && !await claimVoenForUser\(tx, \{ voenDigits: application\.voenNormalized, userId: user\.id, applicationId: application\.id \}\)\)/);
  assert.doesNotMatch(service, /confirmDuplicateVoen:|DUPLICATE_VOEN_UNCONFIRMED/, "no override path");
  assert.match(read("app/api/admin/vendors/route.ts"), /if \(!await claimVoenForUser\(tx, \{ voenDigits: values\.voen, userId: "" \}\)\) throw new VoenInUseError\(\);/);
  assert.match(read("app/api/vendor/[storeId]/[section]/route.ts"), /if\(typeof legalPatch\.voen==="string"&&legalPatch\.voen!==owned\.vendor\.voen&&!await claimVoenForUser\(tx,\{voenDigits:legalPatch\.voen,userId:access\.user\.id\}\)\)throw new VoenInUseError\(\);/);
  assert.match(read("lib/seller-application-http.ts"), /case "DUPLICATE_VOEN": return applicantJson\(\{ error: VOEN_IN_USE_MESSAGE, code: error\.code, field: "voen" \}, 409\);/);
  const review = read("components/admin-seller-application-review.tsx");
  assert.doesNotMatch(review, /confirmDuplicate/);
  assert.match(review, /\(!accountReady \|\| duplicateCount > 0\)/);
});

test("migration 20261115120000 is additive only: one new table, its indexes, foreign keys and CHECKs", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const sql = readFileSync(join(__dirname, "..", "prisma/migrations/20261115120000_seller_voen_verification/migration.sql"), "utf8").replace(/\r\n/g, "\n");
  const statements = sql.split(";").map((s) => s.replace(/--.*$/gm, "").trim()).filter(Boolean);
  for (const statement of statements) {
    assert.match(statement, /^(CREATE TABLE "SellerVoenVerification"|CREATE (UNIQUE )?INDEX "SellerVoenVerification_[A-Za-z_]+" ON "SellerVoenVerification"|ALTER TABLE "SellerVoenVerification" ADD CONSTRAINT)/, statement.slice(0, 80));
  }
  assert.doesNotMatch(sql, /^\s*(DROP|UPDATE|DELETE|INSERT|TRUNCATE)\b|ALTER TABLE "(?!SellerVoenVerification)/m, "no statement touches existing tables or rows");
  assert.match(sql, /CHECK \("voen" ~ '\^\[0-9\]\{9\}\[12\]\$'\)/);
  assert.match(sql, /CREATE UNIQUE INDEX "SellerVoenVerification_userId_voen_key"/);
});

test("admin verification API: same-origin -> ADMIN -> bounded body -> strict validation -> service; reset on VÖEN change", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8").replace(/\r\n/g, "\n");
  const route = read("app/api/admin/voen-verification/route.ts");
  const order = ["csrfRejection(request)", 'requireRole("ADMIN")', "readJsonBodyLimited(request", "bodySchema.safeParse(body.value)", "verifyVoen(prisma"].map((needle) => route.indexOf(needle));
  assert.ok(order.every((position) => position > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "only an admin reaches the service");
  assert.match(route, /if \(!admin\) return NextResponse\.json\(\{ error: "İcazə yoxdur" \}, \{ status: 403, headers \}\);/);
  assert.match(route, /\.strict\(\)/);
  assert.doesNotMatch(route, /^export const (?!dynamic)/m);
  const service = read("lib/voen-verification.ts");
  assert.match(service, /if \(await currentVoenOf\(tx, input\.userId\) !== parsed\.voen\) throw new VoenVerificationError\("STALE"\);/);
  assert.match(service, /action: "SELLER_VOEN_VERIFIED"/);
  assert.match(service, /action: "SELLER_VOEN_VERIFICATION_REVOKED"/);
  assert.match(service, /action: "SELLER_VOEN_VERIFICATION_RESET"/);
  assert.doesNotMatch(service, /fetch\(|e-taxes/i, "the server never calls e-taxes");
  const vendor = read("app/api/vendor/[storeId]/[section]/route.ts");
  assert.match(vendor, /if\(legalPatch\.voen!==undefined&&\(legalPatch\.voen\?\?null\)!==owned\.vendor\.voen\)await resetVoenVerificationOnChange\(tx,\{userId:access\.user\.id,actorId:access\.user\.id\}\);/);
});

test("admin UI: VÖEN panel on the application review and the store page; bulk page; official link in a new tab", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8").replace(/\r\n/g, "\n");
  const panel = read("components/admin-voen-panel.tsx");
  assert.match(panel, /<a href=\{VOEN_LOOKUP_URL\} target="_blank" rel="noopener noreferrer"[^>]*>.*e-taxes-də yoxla<\/a>/);
  assert.match(panel, /navigator\.clipboard\.writeText\(view\.voen\)/);
  assert.match(panel, />\{busy \? "Gözləyin…" : "VÖEN təsdiqləndi"\}</);
  assert.match(panel, />\{busy \? "Gözləyin…" : "Təsdiqi geri götür"\}</);
  assert.match(panel, /const noteOk = note\.trim\(\)\.length >= 3;/);
  assert.match(panel, /disabled=\{busy \|\| !noteOk\}/, "both actions need a note");
  assert.match(read("lib/voen.ts"), /export const VOEN_LOOKUP_URL = "https:\/\/new\.e-taxes\.gov\.az\/etaxes\/services\/taxpayer-info";/);
  assert.match(read("lib/voen-verification.ts"), /VOEN_STATUS_LABELS: Record<VoenStatus, string> = \{ VERIFIED: "Təsdiqlənib", UNVERIFIED: "Yoxlanmayıb" \}/);
  assert.match(read("app/admin/seller-applications/[id]/page.tsx"), /<AdminVoenPanel view=\{voenView\} \/>/);
  assert.match(read("app/admin/_sections/store-detail.tsx"), /\{voenView&&<div className="mb-5"><AdminVoenPanel view=\{voenView\}\/><\/div>\}/);
  const bulk = read("app/admin/voen/page.tsx");
  assert.match(bulk, /const admin = await requireRole\("ADMIN"\);\n\s*if \(!admin\) redirect\("\/admin\/login"\);/);
  assert.match(read("components/admin-voen-bulk.tsx"), /const canSelect = !row\.verified && row\.formatValid && !row\.duplicate;/);
});

test("badge: the only renderer is gated on sellerVerified, computed from the admin verification (fails closed)", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = join(__dirname, "..");
  const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
  const walk = (dir: string): string[] => readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(`${dir}/${entry.name}`) : /\.tsx?$/.test(entry.name) ? [`${dir}/${entry.name}`] : []);
  // Rendered as a badge = the text right after a JSX element (not comments or admin help text).
  const renderers = ["app", "components"].flatMap(walk).filter((file) => /\/>Təsdiqlənmiş satıcı<|>Təsdiqlənmiş satıcı<\/span>/.test(read(file)));
  assert.deepEqual(renderers, ["components/storefront-branding.tsx"], "one place renders the badge");
  assert.match(read("components/storefront-branding.tsx"), /\{store\.sellerVerified && <>\n\s*<span data-seller-verified/);
  const page = read("app/(customer)/stores/[storeId]/page.tsx");
  assert.match(page, /const sellerVerified = await isSellerVoenVerified\(prisma, \{ userId: store\.vendor\.user\.id, voen: store\.vendor\.voen \}\);/);
  assert.match(page, /      sellerVerified,\n/);
  const lib = read("lib/voen-verification.ts");
  assert.match(lib, /export async function isSellerVoenVerified[\s\S]*?try \{\n\s*return \(await verifiedVoenUserIds\(db, \[input\]\)\)\.has\(input\.userId\);\n\s*\} catch \{\n\s*return false;/);
  assert.match(lib, /where: \{ revokedAt: null, OR: wanted\.map/, "revoked verifications never count");
});
