import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { decideGoogleSignIn, intentRole, stateAcceptedCustomerTerms } from "../lib/google-oauth-decision";
import { LEGAL_VERSIONS } from "../lib/legal-versions";

const none = { kind: "none" } as const;
const one = (role: "CUSTOMER" | "VENDOR" | "ADMIN", isActive = true) => ({ kind: "one", id: `user-${role.toLowerCase()}`, role, isActive }) as const;
const linked = (role: "CUSTOMER" | "VENDOR" | "ADMIN", isActive = true) => ({ id: `linked-${role.toLowerCase()}`, role, isActive });
/** The cases below are about roles and links; the terms gate is covered by its own tests (accepted unless stated). */
const decide = (input: Omit<Parameters<typeof decideGoogleSignIn>[0], "customerTermsAccepted"> & { customerTermsAccepted?: boolean }) =>
  decideGoogleSignIn({ customerTermsAccepted: true, ...input });

test("intent maps to a fixed server-side role", () => {
  assert.equal(intentRole("customer"), "CUSTOMER");
  assert.equal(intentRole("vendor"), "VENDOR");
});

test("new customer: no account, customer page, current terms accepted on /register creates a CUSTOMER account", () => {
  assert.deepEqual(decide({ intent: "customer", linkedUser: null, existing: none }), { kind: "create-customer" });
});

test("returning customer: a linked active customer is signed in", () => {
  assert.deepEqual(decide({ intent: "customer", linkedUser: linked("CUSTOMER"), existing: none }), { kind: "session", userId: "linked-customer" });
});

test("returning seller: a linked active seller is signed in on the seller page", () => {
  assert.deepEqual(decide({ intent: "vendor", linkedUser: linked("VENDOR"), existing: none }), { kind: "session", userId: "linked-vendor" });
});

test("seller page with no seller account never creates an account", () => {
  assert.deepEqual(decide({ intent: "vendor", linkedUser: null, existing: none }), { kind: "redirect", result: "seller-not-found" });
});

test("existing same-role password account goes through password-confirmed linking", () => {
  assert.deepEqual(decide({ intent: "customer", linkedUser: null, existing: one("CUSTOMER") }), { kind: "link", userId: "user-customer", role: "CUSTOMER" });
  assert.deepEqual(decide({ intent: "vendor", linkedUser: null, existing: one("VENDOR") }), { kind: "link", userId: "user-vendor", role: "VENDOR" });
});

test("other-role email gets account-exists with the correct portal and no password prompt", () => {
  assert.deepEqual(decide({ intent: "customer", linkedUser: null, existing: one("VENDOR") }), { kind: "redirect", result: "account-exists", portal: "vendor" });
  assert.deepEqual(decide({ intent: "vendor", linkedUser: null, existing: one("CUSTOMER") }), { kind: "redirect", result: "account-exists", portal: "customer" });
});

test("wrong role: a Google identity linked to another role is sent to that portal", () => {
  assert.deepEqual(decide({ intent: "customer", linkedUser: linked("VENDOR"), existing: none }), { kind: "redirect", result: "wrong-role", portal: "vendor" });
  assert.deepEqual(decide({ intent: "vendor", linkedUser: linked("CUSTOMER"), existing: none }), { kind: "redirect", result: "wrong-role", portal: "customer" });
});

test("admin email is never signed in, linked or created through Google", () => {
  for (const intent of ["customer", "vendor"] as const) {
    assert.deepEqual(decide({ intent, linkedUser: null, existing: one("ADMIN") }), { kind: "redirect", result: "account-exists", portal: "admin" });
    assert.deepEqual(decide({ intent, linkedUser: linked("ADMIN"), existing: none }), { kind: "redirect", result: "wrong-role", portal: "admin" });
  }
});

test("inactive accounts get account-inactive, whether linked or matched by email", () => {
  for (const intent of ["customer", "vendor"] as const) {
    for (const role of ["CUSTOMER", "VENDOR", "ADMIN"] as const) {
      assert.deepEqual(decide({ intent, linkedUser: linked(role, false), existing: none }), { kind: "redirect", result: "account-inactive" });
      assert.deepEqual(decide({ intent, linkedUser: null, existing: one(role, false) }), { kind: "redirect", result: "account-inactive" });
    }
  }
});

test("ambiguous email matches never merge or create", () => {
  for (const intent of ["customer", "vendor"] as const) {
    assert.deepEqual(decide({ intent, linkedUser: null, existing: { kind: "ambiguous" } }), { kind: "redirect", result: "account-exists" });
  }
});

test("no decision ever creates a seller", () => {
  const roles = ["CUSTOMER", "VENDOR", "ADMIN"] as const;
  const existingCases = [none, { kind: "ambiguous" } as const, ...roles.flatMap((role) => [one(role), one(role, false)])];
  const linkedCases = [null, ...roles.flatMap((role) => [linked(role), linked(role, false)])];
  for (const linkedUser of linkedCases) {
    for (const existing of existingCases) {
      const decision = decide({ intent: "vendor", linkedUser, existing });
      assert.notEqual(decision.kind, "create-customer");
      if (decision.kind === "session") assert.equal(linkedUser?.role, "VENDOR");
    }
  }
});

test("callback creates only CUSTOMER accounts and maps unverified email to its own code", () => {
  const callback = readFileSync("app/api/auth/google/callback/route.ts", "utf8");
  // SIGNUP-EASY-2: the creation itself lives in the shared lib/google-customer-account.ts.
  const creation = readFileSync("lib/google-customer-account.ts", "utf8");
  assert.match(callback, /decideGoogleSignIn\(/);
  assert.match(callback, /createGoogleCustomerAccount\(prisma, identity\)/);
  assert.match(creation, /role: "CUSTOMER",/);
  for (const source of [callback, creation]) assert.doesNotMatch(source, /role: "VENDOR"|vendorProfile|WELCOME_SELLER|role = state\.intent/);
  assert.match(callback, /error instanceof GoogleEmailUnverifiedError\) return finish\(NextResponse\.redirect\(resultUrl\(origin, state, "email-unverified"\)\)\)/);
  assert.doesNotMatch(callback, /"\/vendor\/register"/);
});

test("start route refuses seller registration through Google", () => {
  const start = readFileSync("app/api/auth/google/start/route.ts", "utf8");
  assert.match(start, /if \(intent === "vendor" && mode === "register"\) \{\s*return NextResponse\.redirect\(new URL\("\/vendor\/login\?oauth=invalid", origin\)\);/);
  assert.ok(start.indexOf('intent === "vendor" && mode === "register"') < start.indexOf("googleAuthorizationUrl({"));
});

test("decision 1a: an unknown email without accepted terms (the /login start) creates nothing and goes to /register", () => {
  assert.deepEqual(decideGoogleSignIn({ intent: "customer", linkedUser: null, existing: none, customerTermsAccepted: false }), { kind: "redirect", result: "register-required" });
  // Existing customers still sign in or link normally without the box.
  assert.deepEqual(decideGoogleSignIn({ intent: "customer", linkedUser: linked("CUSTOMER"), existing: none, customerTermsAccepted: false }), { kind: "session", userId: "linked-customer" });
  assert.deepEqual(decideGoogleSignIn({ intent: "customer", linkedUser: null, existing: one("CUSTOMER"), customerTermsAccepted: false }), { kind: "link", userId: "user-customer", role: "CUSTOMER" });
  // The seller page is unchanged: it only signs in or links, never creates.
  assert.deepEqual(decideGoogleSignIn({ intent: "vendor", linkedUser: null, existing: none, customerTermsAccepted: false }), { kind: "redirect", result: "seller-not-found" });
  assert.deepEqual(decideGoogleSignIn({ intent: "vendor", linkedUser: null, existing: none, customerTermsAccepted: true }), { kind: "redirect", result: "seller-not-found" });
});

test("only the current customer-terms version from a customer /register state counts as accepted", () => {
  const current = LEGAL_VERSIONS.CUSTOMER_TERMS;
  assert.equal(stateAcceptedCustomerTerms({ intent: "customer", mode: "register", termsVersion: current }), true);
  assert.equal(stateAcceptedCustomerTerms({ intent: "customer", mode: "register" }), false, "no version (box not ticked)");
  assert.equal(stateAcceptedCustomerTerms({ intent: "customer", mode: "register", termsVersion: "2020-01-01" }), false, "stale or mismatched version");
  assert.equal(stateAcceptedCustomerTerms({ intent: "customer", mode: "login", termsVersion: current }), false, "/login never creates");
  assert.equal(stateAcceptedCustomerTerms({ intent: "vendor", mode: "register", termsVersion: current }), false);
});

test("callback: create only with accepted terms, the acceptance in the same transaction, /register for register-required", () => {
  const callback = readFileSync("app/api/auth/google/callback/route.ts", "utf8");
  assert.match(callback, /customerTermsAccepted: stateAcceptedCustomerTerms\(state\)/);
  // SIGNUP-EASY-2: the callback's create branch calls the shared function; its one transaction records the acceptance.
  const branch = callback.slice(callback.indexOf('if (decision.kind === "create-customer") {'), callback.indexOf("decision = { kind: \"session\", userId: user.id }"));
  assert.match(branch, /createGoogleCustomerAccount\(prisma, identity\)/);
  const creation = readFileSync("lib/google-customer-account.ts", "utf8");
  const create = creation.slice(creation.indexOf("db.$transaction(async transaction =>"));
  assert.match(create, /recordAcceptance\(transaction, \{ userId: created\.id, document: "CUSTOMER_TERMS", source: "REGISTER_GOOGLE" \}\)/);
  assert.match(callback, /REGISTER_RESULTS = new Set\(\["register-required", "terms-required"\]\)/);
  assert.match(callback, /REGISTER_RESULTS\.has\(result\) \? "\/register"/);
});

test("start route: customer registration needs acceptTerms=1 and signs the current version into the state", () => {
  const start = readFileSync("app/api/auth/google/start/route.ts", "utf8");
  assert.match(start, /intent === "customer" && mode === "register" && params\.get\("acceptTerms"\) !== "1"/);
  assert.match(start, /"\/register\?oauth=terms-required"/);
  assert.match(start, /termsVersion: LEGAL_VERSIONS\.CUSTOMER_TERMS/);
  assert.ok(start.indexOf('params.get("acceptTerms")') < start.indexOf("googleAuthorizationUrl({"));
});
