import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { decideGoogleSignIn, intentRole } from "../lib/google-oauth-decision";

const none = { kind: "none" } as const;
const one = (role: "CUSTOMER" | "VENDOR" | "ADMIN", isActive = true) => ({ kind: "one", id: `user-${role.toLowerCase()}`, role, isActive }) as const;
const linked = (role: "CUSTOMER" | "VENDOR" | "ADMIN", isActive = true) => ({ id: `linked-${role.toLowerCase()}`, role, isActive });

test("intent maps to a fixed server-side role", () => {
  assert.equal(intentRole("customer"), "CUSTOMER");
  assert.equal(intentRole("vendor"), "VENDOR");
});

test("new customer: no account on the customer page creates a CUSTOMER account", () => {
  assert.deepEqual(decideGoogleSignIn({ intent: "customer", linkedUser: null, existing: none }), { kind: "create-customer" });
});

test("returning customer: a linked active customer is signed in", () => {
  assert.deepEqual(decideGoogleSignIn({ intent: "customer", linkedUser: linked("CUSTOMER"), existing: none }), { kind: "session", userId: "linked-customer" });
});

test("returning seller: a linked active seller is signed in on the seller page", () => {
  assert.deepEqual(decideGoogleSignIn({ intent: "vendor", linkedUser: linked("VENDOR"), existing: none }), { kind: "session", userId: "linked-vendor" });
});

test("seller page with no seller account never creates an account", () => {
  assert.deepEqual(decideGoogleSignIn({ intent: "vendor", linkedUser: null, existing: none }), { kind: "redirect", result: "seller-not-found" });
});

test("existing same-role password account goes through password-confirmed linking", () => {
  assert.deepEqual(decideGoogleSignIn({ intent: "customer", linkedUser: null, existing: one("CUSTOMER") }), { kind: "link", userId: "user-customer", role: "CUSTOMER" });
  assert.deepEqual(decideGoogleSignIn({ intent: "vendor", linkedUser: null, existing: one("VENDOR") }), { kind: "link", userId: "user-vendor", role: "VENDOR" });
});

test("other-role email gets account-exists with the correct portal and no password prompt", () => {
  assert.deepEqual(decideGoogleSignIn({ intent: "customer", linkedUser: null, existing: one("VENDOR") }), { kind: "redirect", result: "account-exists", portal: "vendor" });
  assert.deepEqual(decideGoogleSignIn({ intent: "vendor", linkedUser: null, existing: one("CUSTOMER") }), { kind: "redirect", result: "account-exists", portal: "customer" });
});

test("wrong role: a Google identity linked to another role is sent to that portal", () => {
  assert.deepEqual(decideGoogleSignIn({ intent: "customer", linkedUser: linked("VENDOR"), existing: none }), { kind: "redirect", result: "wrong-role", portal: "vendor" });
  assert.deepEqual(decideGoogleSignIn({ intent: "vendor", linkedUser: linked("CUSTOMER"), existing: none }), { kind: "redirect", result: "wrong-role", portal: "customer" });
});

test("admin email is never signed in, linked or created through Google", () => {
  for (const intent of ["customer", "vendor"] as const) {
    assert.deepEqual(decideGoogleSignIn({ intent, linkedUser: null, existing: one("ADMIN") }), { kind: "redirect", result: "account-exists", portal: "admin" });
    assert.deepEqual(decideGoogleSignIn({ intent, linkedUser: linked("ADMIN"), existing: none }), { kind: "redirect", result: "wrong-role", portal: "admin" });
  }
});

test("inactive accounts get account-inactive, whether linked or matched by email", () => {
  for (const intent of ["customer", "vendor"] as const) {
    for (const role of ["CUSTOMER", "VENDOR", "ADMIN"] as const) {
      assert.deepEqual(decideGoogleSignIn({ intent, linkedUser: linked(role, false), existing: none }), { kind: "redirect", result: "account-inactive" });
      assert.deepEqual(decideGoogleSignIn({ intent, linkedUser: null, existing: one(role, false) }), { kind: "redirect", result: "account-inactive" });
    }
  }
});

test("ambiguous email matches never merge or create", () => {
  for (const intent of ["customer", "vendor"] as const) {
    assert.deepEqual(decideGoogleSignIn({ intent, linkedUser: null, existing: { kind: "ambiguous" } }), { kind: "redirect", result: "account-exists" });
  }
});

test("no decision ever creates a seller", () => {
  const roles = ["CUSTOMER", "VENDOR", "ADMIN"] as const;
  const existingCases = [none, { kind: "ambiguous" } as const, ...roles.flatMap((role) => [one(role), one(role, false)])];
  const linkedCases = [null, ...roles.flatMap((role) => [linked(role), linked(role, false)])];
  for (const linkedUser of linkedCases) {
    for (const existing of existingCases) {
      const decision = decideGoogleSignIn({ intent: "vendor", linkedUser, existing });
      assert.notEqual(decision.kind, "create-customer");
      if (decision.kind === "session") assert.equal(linkedUser?.role, "VENDOR");
    }
  }
});

test("callback creates only CUSTOMER accounts and maps unverified email to its own code", () => {
  const callback = readFileSync("app/api/auth/google/callback/route.ts", "utf8");
  assert.match(callback, /decideGoogleSignIn\(/);
  assert.match(callback, /role: "CUSTOMER",/);
  assert.doesNotMatch(callback, /role: "VENDOR"|vendorProfile|WELCOME_SELLER|role = state\.intent/);
  assert.match(callback, /error instanceof GoogleEmailUnverifiedError\) return finish\(NextResponse\.redirect\(resultUrl\(origin, state, "email-unverified"\)\)\)/);
  assert.doesNotMatch(callback, /"\/vendor\/register"/);
});

test("start route refuses seller registration through Google", () => {
  const start = readFileSync("app/api/auth/google/start/route.ts", "utf8");
  assert.match(start, /if \(intent === "vendor" && mode === "register"\) \{\s*return NextResponse\.redirect\(new URL\("\/vendor\/login\?oauth=invalid", origin\)\);/);
  assert.ok(start.indexOf('intent === "vendor" && mode === "register"') < start.indexOf("googleAuthorizationUrl({"));
});
