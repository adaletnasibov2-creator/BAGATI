import test from "node:test";
import assert from "node:assert/strict";
import { cookieSecureFor } from "../lib/cookie-security";

test("production HTTPS pages always get Secure auth cookies", () => {
  assert.equal(cookieSecureFor({ production: true, origin: "https://shopbagati.com" }), true);
  assert.equal(cookieSecureFor({ production: true, origin: "https://192.168.1.20:3000" }), true);
});

test("a phone on a plain-HTTP private LAN page gets a cookie it can actually store", () => {
  assert.equal(cookieSecureFor({ production: true, origin: "http://192.168.1.20:3000" }), false);
  assert.equal(cookieSecureFor({ production: true, origin: "http://10.0.0.5:3000" }), false);
  assert.equal(cookieSecureFor({ production: true, origin: "http://localhost:3000" }), false);
  assert.equal(cookieSecureFor({ production: true, referer: "http://172.16.4.2:3000/vendor/login" }), false);
});

test("public dotted hosts over HTTP never downgrade the cookie", () => {
  assert.equal(cookieSecureFor({ production: true, origin: "http://shopbagati.com" }), true);
  assert.equal(cookieSecureFor({ production: true, origin: "http://8.8.8.8" }), true);
});

test("missing, opaque or malformed origins keep Secure (e.g. the Google OAuth callback)", () => {
  assert.equal(cookieSecureFor({ production: true }), true);
  assert.equal(cookieSecureFor({ production: true, origin: "null" }), true);
  assert.equal(cookieSecureFor({ production: true, origin: "not a url" }), true);
});

test("Origin wins over Referer, so a forged Referer cannot downgrade an HTTPS request", () => {
  assert.equal(cookieSecureFor({ production: true, origin: "https://shopbagati.com", referer: "http://192.168.1.20/" }), true);
});

test("development keeps cookies non-Secure as before", () => {
  assert.equal(cookieSecureFor({ production: false, origin: "https://shopbagati.com" }), false);
});
