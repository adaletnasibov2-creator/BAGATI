import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { storeInquirySchema, inquiryIssueMessage, hashInquiryIp, INQUIRY_MESSAGES, INQUIRY_LIMITS, INQUIRY_IP_RATE_LIMIT, INQUIRY_STORE_RATE_LIMIT } from "../lib/store-inquiry";
import { consumeAuthProcessRateLimit, authRateLimitKey } from "../lib/auth-rate-limit";
import { buildTransactionalEmail, safeReplyTo, EMAIL_TEMPLATES } from "../lib/email-templates";
import { vendorInboxUrl } from "../lib/store-inquiry-submit";
import { AZ_PHONE_ERROR } from "../lib/az-phone";

// Secrets are read when a function is called, not at import time.
process.env.SESSION_SECRET ??= "bagati-isolated-store-inquiry-unit-test-secret";

const valid = { name: "Aysel Məmmədova", contactEmail: "Aysel@Example.az", contactPhone: "", message: "Salam, bu məhsul hələ satışdadır?", website: "", consent: true };
const parse = (overrides: Record<string, unknown>) => storeInquirySchema.safeParse({ ...valid, ...overrides });
const firstError = (overrides: Record<string, unknown>) => { const result = parse(overrides); return result.success ? null : inquiryIssueMessage(result.error); };

test("valid input: email only, phone only, or both; email lowercased, phone stored as E.164", () => {
  assert.deepEqual(storeInquirySchema.parse(valid), { name: "Aysel Məmmədova", contactEmail: "aysel@example.az", contactPhone: null, message: "Salam, bu məhsul hələ satışdadır?", honeypotFilled: false });
  assert.equal(storeInquirySchema.parse({ ...valid, contactEmail: "", contactPhone: "055 761 43 32" }).contactPhone, "+994557614332");
  const both = storeInquirySchema.parse({ ...valid, contactPhone: "+994 50 123 45 67" });
  assert.equal(both.contactEmail, "aysel@example.az");
  assert.equal(both.contactPhone, "+994501234567");
});

test("at least one reply contact is required", () => {
  assert.equal(firstError({ contactEmail: "", contactPhone: "" }), INQUIRY_MESSAGES.contactRequired);
  assert.equal(firstError({ contactEmail: undefined, contactPhone: undefined }), INQUIRY_MESSAGES.contactRequired);
});

test("strict length limits and Azerbaijani messages", () => {
  assert.equal(firstError({ name: "A" }), INQUIRY_MESSAGES.name);
  assert.equal(firstError({ name: "A".repeat(INQUIRY_LIMITS.nameMax + 1) }), INQUIRY_MESSAGES.name);
  assert.equal(firstError({ message: "qısa" }), INQUIRY_MESSAGES.message);
  assert.equal(firstError({ message: "x".repeat(INQUIRY_LIMITS.messageMax + 1) }), INQUIRY_MESSAGES.message);
  assert.equal(parse({ message: "x".repeat(INQUIRY_LIMITS.messageMax) }).success, true);
  assert.equal(firstError({ contactEmail: "not-an-email" }), INQUIRY_MESSAGES.email);
  assert.equal(firstError({ contactEmail: `${"a".repeat(250)}@x.az` }), INQUIRY_MESSAGES.email);
  assert.equal(firstError({ contactEmail: "", contactPhone: "12345" }), AZ_PHONE_ERROR);
});

test("header injection: CR/LF or control characters in single-line fields are rejected", () => {
  assert.equal(firstError({ name: "Aysel\r\nBcc: victim@example.com" }), INQUIRY_MESSAGES.name);
  assert.equal(parse({ contactEmail: "a@example.az\r\nBcc: victim@example.com" }).success, false);
  assert.equal(parse({ contactEmail: "a@example.az\nX" }).success, false);
  assert.equal(firstError({ message: "Salam\u0000 dünya, necəsiniz?" }), INQUIRY_MESSAGES.message);
});

test("messages keep line breaks, normalize CRLF and collapse blank runs", () => {
  assert.equal(storeInquirySchema.parse({ ...valid, message: "Birinci sətir\r\n\r\n\r\n\r\nİkinci sətir" }).message, "Birinci sətir\n\nİkinci sətir");
});

test("consent must be exactly true; unknown fields are rejected", () => {
  assert.equal(firstError({ consent: false }), INQUIRY_MESSAGES.consent);
  assert.equal(firstError({ consent: "on" }), INQUIRY_MESSAGES.consent);
  assert.equal(parse({ consent: undefined }).success, false);
  assert.equal(parse({ storeEmail: "x@y.az" }).success, false);
});

test("honeypot is detected (and handled by the route without saving)", () => {
  assert.equal(storeInquirySchema.parse({ ...valid, website: "http://spam.example" }).honeypotFilled, true);
  const route = readFileSync("app/api/stores/[storeId]/inquiries/route.ts", "utf8");
  const honeypot = route.indexOf("parsed.data.honeypotFilled");
  assert.ok(honeypot > 0 && honeypot < route.indexOf("consumeAuthRateLimit(") && honeypot < route.indexOf("submitStoreInquiry(prisma"), "honeypot answers before any rate-limit write or database write");
});

test("IP is stored only as a keyed hash", () => {
  const first = hashInquiryIp("203.0.113.7");
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(hashInquiryIp("203.0.113.7"), first);
  assert.notEqual(hashInquiryIp("203.0.113.8"), first);
  assert.equal(first.includes("203"), false);
  const source = readFileSync("lib/store-inquiry-submit.ts", "utf8") + readFileSync("app/api/stores/[storeId]/inquiries/route.ts", "utf8");
  assert.match(source, /ipHash: clientIp \? hashInquiryIp\(clientIp\) : null/);
  assert.doesNotMatch(source, /ipHash:\s*clientIp\b(?!\s*\?)/);
});

test("rate limits: process limiter blocks after the limit; route applies per-IP and per-store limits", () => {
  const now = 1_000_000;
  for (let index = 0; index < 3; index += 1) assert.equal(consumeAuthProcessRateLimit("store-inquiry-unit", 3, 60_000, now), true);
  assert.equal(consumeAuthProcessRateLimit("store-inquiry-unit", 3, 60_000, now + 1), false);
  assert.equal(consumeAuthProcessRateLimit("store-inquiry-unit", 3, 60_000, now + 60_001), true);
  assert.notEqual(authRateLimitKey("store-inquiry", "ip:203.0.113.7"), authRateLimitKey("store-inquiry", "store:abc"));
  assert.ok(INQUIRY_IP_RATE_LIMIT.limit <= 10 && INQUIRY_STORE_RATE_LIMIT.limit <= 60);
  const route = readFileSync("app/api/stores/[storeId]/inquiries/route.ts", "utf8");
  assert.match(route, /authRateLimitKey\("store-inquiry", `ip:\$\{clientIp\}`\), INQUIRY_IP_RATE_LIMIT\.limit/);
  assert.match(route, /authRateLimitKey\("store-inquiry", `store:\$\{storeId\}`\), INQUIRY_STORE_RATE_LIMIT\.limit/);
  assert.match(route, /status:\s*429|, 429\)/);
});

test("route: same-origin check, JSON only, bounded body, no store email in responses", () => {
  const route = readFileSync("app/api/stores/[storeId]/inquiries/route.ts", "utf8");
  assert.match(route, /const crossSite = csrfRejection\(request\);\s*if \(crossSite\) return crossSite;/);
  assert.match(route, /startsWith\("application\/json"\)/);
  assert.match(route, /readBoundedRequestBody\(request, INQUIRY_LIMITS\.bodyBytes\)/);
  assert.doesNotMatch(route, /contactEmail|storeEmail/);
  assert.equal(INQUIRY_LIMITS.bodyBytes, 8 * 1024);
});

test("notification email: Reply-To is the buyer, HTML is escaped, subject has no line breaks", () => {
  assert.ok(EMAIL_TEMPLATES.includes("STORE_INQUIRY"));
  const message = buildTransactionalEmail("STORE_INQUIRY", {
    storeName: "Qazax\r\nBcc: x@y.az Ev",
    senderName: "<script>alert(1)</script>",
    senderEmail: "buyer@example.az",
    senderPhone: "+994 55 761 43 32",
    message: "Salam <b>satıcı</b>\nİkinci sətir",
    inboxUrl: "https://shopbagati.com/vendor/s1/inquiries",
  }, "BAGATI <no-reply@shopbagati.com>", "store@example.az", "msg-1");
  assert.equal(message.replyTo, "buyer@example.az");
  assert.equal(message.to, "store@example.az");
  assert.doesNotMatch(String(message.subject), /[\r\n]/);
  assert.doesNotMatch(String(message.html), /<script>|<b>satıcı<\/b>/);
  assert.match(String(message.html), /&lt;script&gt;/);
  assert.match(String(message.text), /İkinci sətir/);
  assert.match(String(message.text), /https:\/\/shopbagati\.com\/vendor\/s1\/inquiries/);
});

test("Reply-To is omitted when the buyer gave no email or an unsafe one", () => {
  const base = { storeName: "Mağaza", senderName: "Aysel", senderPhone: "+994 55 761 43 32", message: "Salam, sual var.", inboxUrl: null };
  assert.equal(buildTransactionalEmail("STORE_INQUIRY", { ...base, senderEmail: null }, "BAGATI <no-reply@shopbagati.com>", "s@example.az", "m2").replyTo, undefined);
  for (const unsafe of ["a@b.az\r\nBcc: c@d.az", "Name <a@b.az>", "a@b.az, c@d.az", "a@localhost", ""]) {
    assert.equal(safeReplyTo(unsafe), undefined, JSON.stringify(unsafe));
  }
  assert.equal(safeReplyTo(" buyer@example.az "), "buyer@example.az");
});

test("vendor inbox link only for a well-formed base URL", () => {
  assert.equal(vendorInboxUrl("https://shopbagati.com/", "store_1"), "https://shopbagati.com/vendor/store_1/inquiries");
  assert.equal(vendorInboxUrl(undefined, "s"), null);
  assert.equal(vendorInboxUrl("javascript:alert(1)", "s"), null);
  assert.equal(vendorInboxUrl("not a url", "s"), null);
});

test("vendor inbox API and page are scoped to the seller's own store", () => {
  const api = readFileSync("app/api/vendor/[storeId]/inquiries/route.ts", "utf8");
  assert.match(api, /const access = await requireStoreAccess\(storeId\);\s*if \(!access\)/);
  assert.match(api, /storeId: access\.storeId/);
  const page = readFileSync("app/vendor/[storeId]/inquiries/page.tsx", "utf8");
  // The page now uses requireVendorStorePage, which wraps requireStoreAccess and only adds the redirect of a
  // signed-in CUSTOMER to /vendor/apply (seller application follow-up). Store scoping is unchanged.
  assert.match(page, /requireVendorStorePage\(storeId\)/);
  assert.match(readFileSync("lib/vendor-area.ts", "utf8"), /const access = await requireStoreAccess\(storeId\);\s+if \(access\) return access;/);
  assert.match(page, /where: \{ storeId: access\.storeId \}/);
});
