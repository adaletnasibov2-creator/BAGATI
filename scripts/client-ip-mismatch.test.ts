import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { canonicalHeaderIp, clientIpHeaderMismatch, trustedCloudflareClientIp } from "../lib/trusted-proxy";
import { SECURITY_EVENT_TYPES } from "../lib/security-event-types";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const h = (values: Record<string, string>) => new Headers(values);

test("header values are canonicalised before comparing", () => {
  assert.equal(canonicalHeaderIp(" 203.0.113.5 "), "203.0.113.5");
  assert.equal(canonicalHeaderIp("::ffff:203.0.113.5"), "203.0.113.5", "IPv4-mapped IPv6");
  assert.equal(canonicalHeaderIp("2001:0DB8:0:0:0:0:0:1"), "2001:db8::1");
  for (const bad of ["", "203.0.113.5, 10.0.0.1", "203.0.113.5:443", "unknown", "[2001:db8::1]"]) assert.equal(canonicalHeaderIp(bad), null, bad);
});

test("mismatch only when both headers are present and disagree", () => {
  assert.equal(clientIpHeaderMismatch(h({ "cf-connecting-ip": "203.0.113.5", "x-real-ip": "203.0.113.5" })), false);
  assert.equal(clientIpHeaderMismatch(h({ "cf-connecting-ip": "203.0.113.5", "x-real-ip": "::ffff:203.0.113.5" })), false, "same address, different notation");
  assert.equal(clientIpHeaderMismatch(h({ "cf-connecting-ip": "2001:db8::1", "x-real-ip": "2001:0db8::0001" })), false);
  assert.equal(clientIpHeaderMismatch(h({ "cf-connecting-ip": "203.0.113.5" })), false, "X-Real-IP absent");
  assert.equal(clientIpHeaderMismatch(h({ "x-real-ip": "203.0.113.5" })), false, "CF header absent");
  assert.equal(clientIpHeaderMismatch(h({ "cf-connecting-ip": "203.0.113.5", "x-real-ip": "198.51.100.9" })), true);
  assert.equal(clientIpHeaderMismatch(h({ "cf-connecting-ip": "203.0.113.5", "x-real-ip": "garbage" })), true, "invalid X-Real-IP counts as different");
  assert.equal(clientIpHeaderMismatch(h({ "cf-connecting-ip": "garbage", "x-real-ip": "203.0.113.5" })), true);
});

test("a mismatch makes the client IP unknown; the flag still gates everything", () => {
  const forged = h({ "cf-connecting-ip": "198.51.100.66", "x-real-ip": "203.0.113.5" });
  assert.equal(trustedCloudflareClientIp(forged, true), null);
  assert.equal(trustedCloudflareClientIp(forged, false), null);
  assert.equal(trustedCloudflareClientIp(h({ "cf-connecting-ip": "203.0.113.5", "x-real-ip": "203.0.113.5" }), true), "203.0.113.5");
  assert.equal(trustedCloudflareClientIp(h({ "cf-connecting-ip": "203.0.113.5", "x-real-ip": "203.0.113.5" }), false), null);
});

test("mismatches are recorded as IP_HEADER_MISMATCH events, throttled, in the background, without the IP", async () => {
  assert.ok(SECURITY_EVENT_TYPES.includes("IP_HEADER_MISMATCH"));
  const events = read("lib/security-events.ts");
  assert.match(events, /IP_HEADER_MISMATCH: "HIGH"/);
  assert.match(events, /IP_HEADER_MISMATCH: "OBSERVED"/);
  assert.match(events, /void recordApplicationSecurityEvent\(\{ eventType: "IP_HEADER_MISMATCH", path: key, sourceIp: null/);
  assert.match(events, /noteClientIpHeaderMismatch\(input\.request, input\.path\);/, "login and rate-limit events check it too");
  const { noteClientIpHeaderMismatch } = await import("../lib/security-events");
  const request = new Request("http://localhost/api/auth/login", { headers: { "cf-connecting-ip": "203.0.113.5", "x-real-ip": "203.0.113.5" } });
  assert.equal(noteClientIpHeaderMismatch(request, "/api/auth/login"), false, "no mismatch: nothing recorded");
});
