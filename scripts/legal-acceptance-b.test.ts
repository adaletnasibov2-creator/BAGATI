/**
 * Legal acceptance Phase B (consent checkboxes and gates) without a database: schemas, the signed Google state, the
 * Google start route, the gate functions with an in-memory client, and the wiring of every route that records or
 * enforces an acceptance. Database behaviour (rows, idempotency, 409 then success) is covered by
 * scripts/legal-acceptance-b.integration.test.ts on the verify cluster.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import type { LegalAcceptanceSource, LegalDocument } from "@prisma/client";
import { registerSchema } from "../lib/validation";
import { SELLER_APPLICATION_MESSAGES, sellerApplicationInputSchema, sellerApplicationIssue } from "../lib/seller-application";
import { createGoogleOAuthState, verifyGoogleOAuthState, type GoogleOAuthState } from "../lib/google-oauth";
import { stateAcceptedCustomerTerms } from "../lib/google-oauth-decision";
import { LEGAL_VERSIONS } from "../lib/legal-versions";
import { acceptSellerTermsInPanel, customerTermsGate, LEGAL_GATE_MESSAGES, sellerTermsGate, type LegalGateDb } from "../lib/legal-gates";
import { GET as startGoogleOAuth } from "../app/api/auth/google/start/route";
import { LegalConsentCheckbox, CUSTOMER_CONSENT_PARTS, SELLER_CONSENT_PARTS } from "../components/legal-consent-checkbox";
import { AdminLegalAcceptances } from "../components/admin-legal-acceptances";

(globalThis as { React?: typeof React }).React = React;

const root = join(__dirname, "..");
// CRLF → LF: on a Windows checkout (core.autocrlf=true) the multi-line regexes below would never match.
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const savedEnv = { SESSION_SECRET: process.env.SESSION_SECRET, NODE_ENV: process.env.NODE_ENV, APP_BASE_URL: process.env.APP_BASE_URL, GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET };
process.env.SESSION_SECRET = "legal-acceptance-b-test-session-secret-0123456789";
after(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 1. Email registration schema

test("register schema: acceptTerms must be exactly true", () => {
  const base = { email: "a@example.az", password: "a-long-password-1", firstName: "Aysel", lastName: "Məmmədova" };
  assert.equal(registerSchema.safeParse(base).success, false, "missing");
  assert.equal(registerSchema.safeParse({ ...base, acceptTerms: false }).success, false, "false");
  assert.equal(registerSchema.safeParse({ ...base, acceptTerms: "true" }).success, false, "a string is not consent");
  assert.equal(registerSchema.safeParse({ ...base, acceptTerms: true }).success, true);
});

test("register route: TERMS_REQUIRED message, acceptance inside the account transaction and on both resume paths", () => {
  const route = read("app/api/auth/register/route.ts");
  assert.match(route, /issue\.path\[0\] === "acceptTerms"/);
  assert.match(route, /LEGAL_GATE_MESSAGES\.registerTerms, code: TERMS_REQUIRED/);
  const transaction = route.slice(route.indexOf("user = await prisma.$transaction(async (tx) => {"), route.indexOf("}); } catch (error) {"));
  assert.match(transaction, /tx\.user\.create\(/);
  assert.match(transaction, /await recordAcceptance\(tx, \{ userId: created\.id, document: "CUSTOMER_TERMS", source: "REGISTER_EMAIL" \}\);/);
  assert.equal(route.match(/await recordResumedAcceptance\(userId\);\n\s*return registrationAcknowledgement\(userId, "CUSTOMER", "\/verify-email"\);/g)?.length, 2, "both resume paths record");
  assert.match(route, /if \(!userId\) return;/, "nothing is recorded for an address that is not resumable");
  assert.doesNotMatch(route, /x-forwarded-for|user-agent|userAgent/i, "no IP or user agent stored with the acceptance");
});

test("register form: one checkbox gates both e-mail and Google; the request carries acceptTerms", () => {
  const form = read("components/register-form.tsx");
  assert.match(form, /if \(!acceptTerms\) \{ blockWithoutTerms\(\); return; \}/);
  assert.match(form, /acceptTerms: true \}\)/);
  assert.match(form, /termsGate=\{\{ accepted: acceptTerms, onBlocked: blockWithoutTerms \}\}/);
  assert.match(form, /parts=\{CUSTOMER_CONSENT_PARTS\}/);
});

test("consent checkbox: owner's sentence, links open /terms and /privacy in a new tab, error tied to the box", () => {
  const markup = renderToStaticMarkup(createElement(LegalConsentCheckbox, { id: "x", checked: false, onChange: () => undefined, error: "Səhv", parts: CUSTOMER_CONSENT_PARTS }));
  const text = markup.replace(/<[^>]+>/g, "");
  assert.ok(text.includes("İstifadə şərtləri və Məxfilik siyasəti ilə tanış oldum və razıyam"), text);
  assert.match(markup, /<a target="_blank" rel="noopener noreferrer"[^>]*href="\/terms">İstifadə şərtləri<\/a>/);
  assert.match(markup, /<a target="_blank" rel="noopener noreferrer"[^>]*href="\/privacy">Məxfilik siyasəti<\/a>/);
  assert.match(markup, /type="checkbox"[^>]*aria-invalid="true"[^>]*aria-describedby="x-error"/);
  assert.match(markup, /id="x-error" role="alert"/);
  const seller = renderToStaticMarkup(createElement(LegalConsentCheckbox, { id: "s", checked: true, onChange: () => undefined, parts: SELLER_CONSENT_PARTS }));
  assert.match(seller, /<a target="_blank" rel="noopener noreferrer"[^>]*href="\/seller-terms">Satıcı şərtləri<\/a>/);
  assert.doesNotMatch(seller, /role="alert"/);
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Google: signed state and the start route

const baseState: GoogleOAuthState = { state: "s", nonce: "n", verifier: "v", intent: "customer", mode: "register", next: "/account" };

test("Google state: the accepted version survives signing and is only allowed on customer /register", async () => {
  const token = await createGoogleOAuthState({ ...baseState, termsVersion: LEGAL_VERSIONS.CUSTOMER_TERMS });
  const verified = await verifyGoogleOAuthState(token);
  assert.equal(verified?.termsVersion, LEGAL_VERSIONS.CUSTOMER_TERMS);
  assert.equal(stateAcceptedCustomerTerms(verified!), true);

  for (const bad of [
    { ...baseState, mode: "login" as const, termsVersion: LEGAL_VERSIONS.CUSTOMER_TERMS },
    { ...baseState, intent: "vendor" as const, mode: "login" as const, termsVersion: LEGAL_VERSIONS.CUSTOMER_TERMS },
    { ...baseState, termsVersion: "yes" },
    { ...baseState, termsVersion: 20261117 as unknown as string },
  ]) {
    assert.equal(await verifyGoogleOAuthState(await createGoogleOAuthState(bad)), null, JSON.stringify(bad));
  }
});

test("Google state: a tampered token (other key) is rejected; a mismatched version does not count as accepted", async () => {
  // Same payload, signed with a key that is not the server's: the signature check refuses it.
  const forged = await new SignJWT({ ...baseState, termsVersion: LEGAL_VERSIONS.CUSTOMER_TERMS })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuer("bagati").setAudience("bagati-google-oauth").setIssuedAt().setExpirationTime("600s")
    .sign(new TextEncoder().encode("not-the-server-secret-not-the-server-secret"));
  assert.equal(await verifyGoogleOAuthState(forged), null);
  // A version-shaped but different value (old text or a guess) verifies as a state but never creates an account.
  const stale = await verifyGoogleOAuthState(await createGoogleOAuthState({ ...baseState, termsVersion: "2025-01-01" }));
  assert.ok(stale);
  assert.equal(stateAcceptedCustomerTerms(stale), false);
  // No version at all (a /register start without the box is refused earlier; a /login start never carries one).
  const none = await verifyGoogleOAuthState(await createGoogleOAuthState({ ...baseState, mode: "login" }));
  assert.ok(none);
  assert.equal(stateAcceptedCustomerTerms(none), false);
});

test("Google start: /register without the box goes back to /register; with it the signed state carries the version", async () => {
  Object.assign(process.env, { NODE_ENV: "development" });
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "server-only-test-value";

  const refused = await startGoogleOAuth(new NextRequest("http://localhost:3000/api/auth/google/start?intent=customer&mode=register&next=%2Fcheckout"));
  assert.equal(refused.status, 307);
  const refusedTo = new URL(refused.headers.get("location") ?? "");
  assert.equal(refusedTo.pathname, "/register");
  assert.equal(refusedTo.searchParams.get("oauth"), "terms-required");
  assert.equal(refusedTo.searchParams.get("next"), "/checkout");
  assert.equal(refused.cookies.get("bagati_google_oauth")?.value, undefined, "no OAuth state without consent");

  const accepted = await startGoogleOAuth(new NextRequest("http://localhost:3000/api/auth/google/start?intent=customer&mode=register&acceptTerms=1&next=%2Faccount"));
  assert.equal(new URL(accepted.headers.get("location") ?? "").hostname, "accounts.google.com");
  const signed = await verifyGoogleOAuthState(accepted.cookies.get("bagati_google_oauth")?.value ?? "");
  assert.equal(signed?.termsVersion, LEGAL_VERSIONS.CUSTOMER_TERMS);

  // /login never signs a version, even if the browser adds acceptTerms=1.
  const login = await startGoogleOAuth(new NextRequest("http://localhost:3000/api/auth/google/start?intent=customer&mode=login&acceptTerms=1"));
  const loginState = await verifyGoogleOAuthState(login.cookies.get("bagati_google_oauth")?.value ?? "");
  assert.ok(loginState);
  assert.equal(loginState.termsVersion, undefined);
});

test("Google callback: /login with an unknown email creates no user (the only user.create is the accepted-terms branch)", () => {
  const callback = read("app/api/auth/google/callback/route.ts");
  assert.equal(callback.match(/\.user\.create\(/g)?.length, 1);
  const createBranch = callback.slice(callback.indexOf('if (decision.kind === "create-customer") {'), callback.indexOf('if (decision.kind === "link")'));
  assert.match(createBranch, /transaction\.user\.create\(/);
  assert.match(read("lib/google-oauth-decision.ts"), /input\.customerTermsAccepted \? \{ kind: "create-customer" \} : \{ kind: "redirect", result: "register-required" \}/);
  const button = read("components/google-oauth-button.tsx");
  assert.match(button, /case "register-required": return "Əvvəlcə qeydiyyatdan keçin\./);
});

// ---------------------------------------------------------------------------------------------------------------
// 3. Seller application

test("seller application schema: acceptSellerTerms must be exactly true, with a clear message", () => {
  const base = { displayName: "Aysel Store", phone: "055 123 45 67", sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: "Aysel Məmmədova", voen: "1234 567 892" };
  for (const value of [undefined, false, "on"]) {
    const parsed = sellerApplicationInputSchema.safeParse(value === undefined ? base : { ...base, acceptSellerTerms: value });
    assert.equal(parsed.success, false, String(value));
    if (!parsed.success) assert.equal(sellerApplicationIssue(parsed.error), SELLER_APPLICATION_MESSAGES.sellerTerms);
  }
  assert.equal(sellerApplicationInputSchema.safeParse({ ...base, acceptSellerTerms: true }).success, true);
});

test("seller application: the acceptance is recorded in the submit transaction with the application id", () => {
  const service = read("lib/seller-application-service.ts");
  const submit = service.slice(service.indexOf("export async function submitSellerApplication"), service.indexOf("export async function withdrawSellerApplication"));
  assert.match(submit, /const application = await tx\.vendorApplication\.create\(/);
  assert.match(submit, /await recordAcceptance\(tx, \{ userId: input\.userId, document: "SELLER_TERMS", source: "SELLER_APPLICATION", vendorApplicationId: application\.id \}\);/);
  assert.ok(submit.indexOf("vendorApplication.create(") < submit.indexOf("recordAcceptance("));
  const form = read("components/vendor-apply-form.tsx");
  assert.match(form, /acceptSellerTerms: true \}/);
  assert.match(form, /parts=\{SELLER_CONSENT_PARTS\}/);
});

// ---------------------------------------------------------------------------------------------------------------
// 4/5. Gate functions with an in-memory client

function fakeGateDb(accepted: { userId: string; document: LegalDocument; version: string }[] = []) {
  const rows = accepted.map((row, index) => ({ id: `row${index + 1}`, source: "REGISTER_EMAIL" as LegalAcceptanceSource, ...row }));
  const audits: unknown[] = [];
  const writer = {
    legalAcceptance: {
      async findUnique({ where }: { where: { userId_document_version: { userId: string; document: LegalDocument; version: string } } }) {
        const key = where.userId_document_version;
        const row = rows.find((r) => r.userId === key.userId && r.document === key.document && r.version === key.version);
        return row ? { id: row.id } : null;
      },
      async createMany({ data }: { data: { userId: string; document: LegalDocument; version: string; source: LegalAcceptanceSource }[] }) {
        let count = 0;
        for (const item of data) {
          if (rows.some((r) => r.userId === item.userId && r.document === item.document && r.version === item.version)) continue;
          rows.push({ id: `row${rows.length + 1}`, ...item }); count++;
        }
        return { count };
      },
    },
    auditLog: { async create({ data }: { data: unknown }) { audits.push(data); return data; } },
  };
  const db: LegalGateDb = { ...writer, $transaction: (fn) => fn(writer) };
  return { db, rows, audits };
}

test("checkout gate: 409 TERMS_REQUIRED without the box; recorded once (CHECKOUT) with it; no box needed afterwards", async () => {
  const { db, rows, audits } = fakeGateDb();
  assert.deepEqual(await customerTermsGate(db, "u1", false), { ok: false, status: 409, code: "TERMS_REQUIRED", error: LEGAL_GATE_MESSAGES.termsRequired });
  assert.equal(rows.length, 0, "a refusal writes nothing");
  assert.deepEqual(await customerTermsGate(db, "u1", true), { ok: true, recorded: true });
  assert.deepEqual(rows.map((r) => [r.userId, r.document, r.version, r.source]), [["u1", "CUSTOMER_TERMS", LEGAL_VERSIONS.CUSTOMER_TERMS, "CHECKOUT"]]);
  assert.equal(audits.length, 1);
  assert.deepEqual(await customerTermsGate(db, "u1", false), { ok: true, recorded: false }, "accepted users are not asked again");
});

test("checkout gate: an older accepted version does not count", async () => {
  const { db } = fakeGateDb([{ userId: "u1", document: "CUSTOMER_TERMS", version: "2025-01-01" }]);
  assert.equal((await customerTermsGate(db, "u1", false)).ok, false);
});

test("seller gate and panel acceptance: 409 SELLER_TERMS_REQUIRED, then SELLER_PANEL, then open; a repeat records nothing", async () => {
  const { db, rows, audits } = fakeGateDb([{ userId: "v1", document: "CUSTOMER_TERMS", version: LEGAL_VERSIONS.CUSTOMER_TERMS }]);
  assert.deepEqual(await sellerTermsGate(db, "v1"), { ok: false, status: 409, code: "SELLER_TERMS_REQUIRED", error: LEGAL_GATE_MESSAGES.sellerTermsRequired });
  assert.deepEqual(await acceptSellerTermsInPanel(db, "v1"), { created: true, version: LEGAL_VERSIONS.SELLER_TERMS });
  assert.deepEqual(await sellerTermsGate(db, "v1"), { ok: true, recorded: false });
  assert.deepEqual(await acceptSellerTermsInPanel(db, "v1"), { created: false, version: LEGAL_VERSIONS.SELLER_TERMS });
  assert.equal(rows.filter((r) => r.document === "SELLER_TERMS").length, 1);
  assert.equal(rows.find((r) => r.document === "SELLER_TERMS")?.source, "SELLER_PANEL");
  assert.equal(audits.length, 1);
});

// ---------------------------------------------------------------------------------------------------------------
// Route wiring (source checks; the server never trusts the client flag alone)

test("orders API: the gate runs before the order transaction and answers with its own status and code", () => {
  const route = read("app/api/orders/route.ts");
  assert.match(route, /acceptTerms: z\.boolean\(\)\.optional\(\)/);
  const post = route.slice(route.indexOf("export async function POST"));
  const gate = post.indexOf("termsGate=await customerTermsGate(prisma,user.id,parsed.data.acceptTerms===true)");
  assert.ok(gate > 0 && gate < post.indexOf("db.$transaction("), "gate before the transaction");
  assert.match(post, /if\(!termsGate\.ok\)return NextResponse\.json\(\{error:termsGate\.error,code:termsGate\.code\},\{status:termsGate\.status\}\);/);
  const page = read("app/(customer)/checkout/page.tsx");
  assert.match(page, /hasAcceptedCurrent\(prisma,user\.id,"CUSTOMER_TERMS"\)/);
  assert.match(page, /termsRequired=\{!termsAccepted\}/);
  const form = read("components/checkout-form.tsx");
  assert.match(form, /\{termsRequired&&<div[^>]*><LegalConsentCheckbox id="checkout-accept-terms"/);
  assert.match(form, /if\(data\.code==="TERMS_REQUIRED"\)\{setTermsRequired\(true\)/);
});

test("seller routes: store creation and publishing return 409 SELLER_TERMS_REQUIRED; drafts are not gated", () => {
  const stores = read("app/api/vendor/stores/route.ts");
  const storesPost = stores.slice(stores.indexOf("export async function POST"));
  assert.ok(storesPost.indexOf("sellerTermsGate(prisma, user.id)") < storesPost.indexOf("schema.safeParse(raw)"));
  const products = read("app/api/vendor/[storeId]/products/route.ts");
  const activeBlock = products.slice(products.indexOf('if (value.status === "ACTIVE") {\n    if (!value.categoryId)'), products.indexOf("const product = await db.$transaction"));
  assert.match(activeBlock, /sellerTermsGate\(db, access\.user\.id\)/);
  assert.equal(products.match(/sellerTermsGate\(/g)?.length, 1, "only the publishing branch");
  const patch = read("lib/vendor-product-patch.ts");
  assert.match(patch, /if \(activating && !await hasAcceptedCurrent\(tx, input\.actorUserId, "SELLER_TERMS"\)\) \{\s*throw new VendorProductPatchError\(SELLER_TERMS_REQUIRED\);/);
  assert.match(read("app/api/vendor/[storeId]/products/[productId]/route.ts"), /error\.code === SELLER_TERMS_REQUIRED\) return NextResponse\.json\(\{ error: LEGAL_GATE_MESSAGES\.sellerTermsRequired, code: SELLER_TERMS_REQUIRED \}, \{ status: 409 \}\)/);
  const section = read("app/api/vendor/[storeId]/[section]/route.ts");
  assert.match(section, /if\(isVendorProductActivation\(current\.status,v\.status\)\)\{\s*\/\/[^\n]*\n\s*if\(!await hasAcceptedCurrent\(tx,access\.user\.id,"SELLER_TERMS"\)\)return \{error:SELLER_TERMS_REQUIRED\};/);
  assert.match(section, /result\.error===SELLER_TERMS_REQUIRED\)return NextResponse\.json\(\{error:LEGAL_GATE_MESSAGES\.sellerTermsRequired,code:SELLER_TERMS_REQUIRED\},\{status:409\}\)/);
});

test("seller panel route: the signed-in active seller accepts for themself only; strict body; SELLER_PANEL", () => {
  const route = read("app/api/vendor/legal-acceptance/route.ts");
  assert.match(route, /if \(!user \|\| user\.role !== "VENDOR"\) return json\(/);
  assert.match(route, /z\.object\(\{ accept: z\.literal\(true\) \}\)\.strict\(\)/);
  assert.match(route, /acceptSellerTermsInPanel\(prisma, user\.id\)/);
  assert.doesNotMatch(route, /body\.value\.userId|userId:\s*body/, "the user id never comes from the body");
  assert.match(read("lib/legal-gates.ts"), /recordAcceptance\(tx, \{ userId, document, source \}\)/);
});

test("seller panel UI: the card shows on /vendor, /vendor/stores/new and every store page until accepted; forms show it on 409", () => {
  for (const path of ["app/vendor/page.tsx", "app/vendor/stores/new/page.tsx", "app/vendor/[storeId]/layout.tsx"]) {
    const source = read(path);
    assert.match(source, /hasAcceptedCurrent\(prisma, (user|access\.user)\.id, "SELLER_TERMS"\)/, path);
    assert.match(source, /\{!sellerTermsAccepted && <div className="[^"]+"><SellerTermsCard\/><\/div>\}/, path);
  }
  for (const path of ["components/vendor-store-create-form.tsx", "components/vendor-product-create-form.tsx", "components/vendor-product-editor.tsx"]) {
    const source = read(path);
    assert.match(source, /result\.code === "SELLER_TERMS_REQUIRED"\) setTermsRequired\(true\)/, path);
    assert.match(source, /<SellerTermsCard compact onAccepted=/, path);
  }
  const card = read("components/seller-terms-card.tsx");
  assert.match(card, /fetch\("\/api\/vendor\/legal-acceptance", \{ method: "POST"/);
  assert.match(card, /href="\/seller-terms" target="_blank"/);
});

// ---------------------------------------------------------------------------------------------------------------
// 7. Admin (read-only)

test("admin: acceptances are listed read-only on the customer, seller and seller-application pages", () => {
  const markup = renderToStaticMarkup(createElement(AdminLegalAcceptances, {
    applicationId: "app1",
    rows: [
      { id: "r1", document: "SELLER_TERMS", version: LEGAL_VERSIONS.SELLER_TERMS, source: "SELLER_APPLICATION", acceptedAt: new Date("2026-11-18T08:00:00Z"), vendorApplicationId: "app1" },
      { id: "r2", document: "CUSTOMER_TERMS", version: "2025-01-01", source: "REGISTER_EMAIL", acceptedAt: new Date("2025-01-02T08:00:00Z"), vendorApplicationId: null },
    ],
  }));
  const text = markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(text, /Satıcı şərtləri · versiya 2026-11-18 Hazırkı versiya/);
  assert.match(text, /Satıcı müraciəti · 2026-11-18 12:00:00/, "Baku time");
  assert.match(text, /Bu müraciətlə qəbul edilib/);
  assert.match(text, /İstifadə şərtləri · versiya 2025-01-01 Köhnə versiya/);
  assert.doesNotMatch(markup, /<form|<button|<input/, "read-only");
  assert.match(renderToStaticMarkup(createElement(AdminLegalAcceptances, { rows: [] })), /Qeyd yoxdur/);
  assert.match(read("app/admin/_sections/customer-detail.tsx"), /legalAcceptances:\{select:adminLegalAcceptanceSelect/);
  assert.match(read("app/admin/_sections/vendor-detail.tsx"), /<AdminLegalAcceptances rows=\{vendor\.user\.legalAcceptances\}/);
  assert.match(read("app/admin/seller-applications/[id]/page.tsx"), /<AdminLegalAcceptances rows=\{application\.user\.legalAcceptances\} applicationId=\{application\.id\}/);
});
