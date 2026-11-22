/**
 * ADMIN-IP-TEST-1: "Saxtalaşdırma testi" on the admin "Müştəri IP başlıqları" card. Unit tests only (Node): the pure
 * decision, the forged headers against the real server-side diagnostics function, and the card wiring (source checks).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  evaluateSpoofTest, FORBIDDEN_REQUEST_HEADER_NAMES, isForbiddenRequestHeader, SPOOF_TEST_HEADERS, SPOOF_TEST_IP, SPOOF_TEST_MASK_PREFIX,
  SPOOF_TEST_TEXTS, spoofTestDisplay,
} from "../lib/admin-ip-spoof-test";
import { clientIpDiagnostics } from "../lib/client-ip-diagnostics";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

test("the test IP is a documentation-only address (RFC 5737 TEST-NET-2) and its mask starts with 198.51.", () => {
  assert.equal(SPOOF_TEST_IP, "198.51.100.23");
  assert.ok(SPOOF_TEST_IP.startsWith("198.51.100."));
  assert.deepEqual(SPOOF_TEST_HEADERS, { "CF-Connecting-IP": "198.51.100.23", "X-Real-IP": "198.51.100.23" });
  assert.equal(SPOOF_TEST_MASK_PREFIX, "198.51.");
});

// ---------------------------------------------------------------- decision (spoofable / safe / unknown)

test("spoofable: the forged address comes back (and the admin's own network is not 198.51.x.x)", () => {
  assert.deepEqual(evaluateSpoofTest({ ok: true, httpStatus: 200, ipWithFlagOn: "198.51.*.*", baselineIp: "5.191.*.*" }), { kind: "spoofable", returnedIp: "198.51.*.*", httpStatus: 200 });
  assert.deepEqual(evaluateSpoofTest({ ok: true, httpStatus: 200, ipWithFlagOn: " 198.51.*.* ", baselineIp: null }).kind, "spoofable", "baseline unknown still counts");
});

test("safe: the admin's real masked IP comes back", () => {
  assert.deepEqual(evaluateSpoofTest({ ok: true, httpStatus: 200, ipWithFlagOn: "5.191.*.*", baselineIp: "5.191.*.*" }), { kind: "safe", returnedIp: "5.191.*.*", httpStatus: 200 });
  assert.equal(evaluateSpoofTest({ ok: true, httpStatus: 200, ipWithFlagOn: "2a02:4780:*:*", baselineIp: null }).kind, "safe", "IPv6");
  assert.equal(evaluateSpoofTest({ ok: true, httpStatus: 200, ipWithFlagOn: "198.5.*.*", baselineIp: null }).kind, "safe", "prefix match is exact (198.5. is not 198.51.)");
});

test("unknown: no IP, refused/failed request, or the admin's own network is 198.51.x.x", () => {
  assert.deepEqual(evaluateSpoofTest({ ok: true, httpStatus: 200, ipWithFlagOn: null, baselineIp: "5.191.*.*" }), { kind: "unknown", returnedIp: null, httpStatus: 200, reason: "no-ip" });
  assert.deepEqual(evaluateSpoofTest({ ok: true, httpStatus: 200, ipWithFlagOn: "  ", baselineIp: null }).reason, "no-ip");
  assert.deepEqual(evaluateSpoofTest({ ok: false, httpStatus: 403, ipWithFlagOn: "198.51.*.*", baselineIp: null }), { kind: "unknown", returnedIp: null, httpStatus: 403, reason: "refused" }, "a refused request is never read as spoofable");
  assert.deepEqual(evaluateSpoofTest({ ok: false, httpStatus: null, ipWithFlagOn: undefined, baselineIp: null }).reason, "refused", "network error");
  assert.deepEqual(evaluateSpoofTest({ ok: true, httpStatus: 200, ipWithFlagOn: "198.51.*.*", baselineIp: "198.51.*.*" }), { kind: "unknown", returnedIp: "198.51.*.*", httpStatus: 200, reason: "same-network" });
});

test("display: red for spoofable, green for safe, green + neutral note for no IP / refused, only the note for same network", () => {
  assert.deepEqual(spoofTestDisplay({ kind: "spoofable", returnedIp: "198.51.*.*", httpStatus: 200 }), { tone: "bad", message: "IP saxtalaşdırıla bilər: başlıqlar yoxlanmadan keçir.", note: null });
  assert.deepEqual(spoofTestDisplay({ kind: "safe", returnedIp: "5.191.*.*", httpStatus: 200 }), { tone: "good", message: "Saxtalaşdırma cəhdi uğursuz oldu: IP başlıqları kənardan dəyişdirilə bilmir.", note: null });
  for (const reason of ["no-ip", "refused"] as const) {
    assert.deepEqual(spoofTestDisplay({ kind: "unknown", returnedIp: null, httpStatus: 200, reason }), { tone: "good", message: SPOOF_TEST_TEXTS.safe, note: SPOOF_TEST_TEXTS.unknownNote }, reason);
  }
  assert.deepEqual(spoofTestDisplay({ kind: "unknown", returnedIp: "198.51.*.*", httpStatus: 200, reason: "same-network" }), { tone: "neutral", message: null, note: SPOOF_TEST_TEXTS.unknownNote });
});

// ---------------------------------------------------------------- headers: allowed for fetch, read by the server

test("CF-Connecting-IP and X-Real-IP are not forbidden request headers, so fetch() may send them", () => {
  for (const name of Object.keys(SPOOF_TEST_HEADERS)) assert.equal(isForbiddenRequestHeader(name), false, name);
  // Sanity checks of the forbidden-name rule itself.
  for (const name of ["Host", "Cookie", "Origin", "Referer", "Sec-Fetch-Site", "Proxy-Authorization", "Content-Length"]) assert.equal(isForbiddenRequestHeader(name), true, name);
  assert.ok(FORBIDDEN_REQUEST_HEADER_NAMES.every((name) => name === name.toLowerCase()));
  // Node's fetch Request keeps them as given (Node is not a browser; see the report for what is not verified).
  const request = new Request("https://shopbagati.com/api/admin/system?card=client-ip", { headers: SPOOF_TEST_HEADERS });
  assert.equal(request.headers.get("cf-connecting-ip"), SPOOF_TEST_IP);
  assert.equal(request.headers.get("x-real-ip"), SPOOF_TEST_IP);
});

test("server side (real clientIpDiagnostics): headers passed through unchanged -> 198.51.*.* -> spoofable", () => {
  const data = clientIpDiagnostics(new Headers(SPOOF_TEST_HEADERS), true);
  assert.equal(data.ipWithFlagOn, "198.51.*.*");
  assert.equal(evaluateSpoofTest({ ok: true, httpStatus: 200, ipWithFlagOn: data.ipWithFlagOn, baselineIp: "5.191.*.*" }).kind, "spoofable");
  // Same answer when the trust flag is off in production: ipWithFlagOn shows what the app WOULD trust with it on.
  assert.equal(clientIpDiagnostics(new Headers(SPOOF_TEST_HEADERS), false).ipWithFlagOn, "198.51.*.*");
});

test("server side: the edge replaced both headers with the real address -> safe", () => {
  const data = clientIpDiagnostics(new Headers({ "cf-connecting-ip": "5.191.20.30", "x-real-ip": "5.191.20.30" }), true);
  assert.equal(evaluateSpoofTest({ ok: true, httpStatus: 200, ipWithFlagOn: data.ipWithFlagOn, baselineIp: "5.191.*.*" }).kind, "safe");
});

test("server side: only one header replaced -> the mismatch guard drops the IP -> unknown (not spoofable)", () => {
  for (const headers of [{ "cf-connecting-ip": "5.191.20.30", "x-real-ip": SPOOF_TEST_IP }, { "cf-connecting-ip": SPOOF_TEST_IP, "x-real-ip": "5.191.20.30" }]) {
    const data = clientIpDiagnostics(new Headers(headers), true);
    assert.equal(data.cfRealIpMismatch, true);
    assert.equal(data.ipWithFlagOn, null);
    assert.equal(evaluateSpoofTest({ ok: true, httpStatus: 200, ipWithFlagOn: data.ipWithFlagOn, baselineIp: "5.191.*.*" }).reason, "no-ip");
  }
});

test("server side: X-Real-IP stripped but CF-Connecting-IP passed through -> spoofable (the gap from the audit)", () => {
  const data = clientIpDiagnostics(new Headers({ "cf-connecting-ip": SPOOF_TEST_IP }), true);
  assert.equal(data.ipWithFlagOn, "198.51.*.*");
  assert.equal(evaluateSpoofTest({ ok: true, httpStatus: 200, ipWithFlagOn: data.ipWithFlagOn, baselineIp: "5.191.*.*" }).kind, "spoofable");
});

// ---------------------------------------------------------------- card wiring

test("the card sends the forged headers to the SAME endpoint with a GET and shows the result; no new route", () => {
  const card = read("components/admin-system-status.tsx");
  assert.match(card, /fetch\("\/api\/admin\/system\?card=client-ip", \{ cache: "no-store", headers: SPOOF_TEST_HEADERS \}\)/);
  assert.doesNotMatch(card, /method: "(POST|PUT|PATCH|DELETE)"/);
  assert.match(card, /evaluateSpoofTest\(\{ ok: response\.ok && body\?\.ok === true, httpStatus: response\.status, ipWithFlagOn: body\?\.data\?\.ipWithFlagOn, baselineIp \}\)/);
  assert.match(card, /<SpoofTest baselineIp=\{data\.ipWithFlagOn\} \/>/);
  assert.match(card, /\{SPOOF_TEST_TEXTS\.returnedIp\}/);
  assert.match(card, /\{busy \? SPOOF_TEST_TEXTS\.busy : SPOOF_TEST_TEXTS\.button\}/);
  // The endpoint is unchanged: admin-only, read-only, request-specific.
  const route = read("app/api/admin/system/route.ts");
  assert.match(route, /const admin = await requireRole\("ADMIN"\);/);
  assert.match(route, /if \(request\.nextUrl\.searchParams\.get\("card"\) === "client-ip"\) \{\n\s*const data = clientIpDiagnostics\(request\.headers, process\.env\.BAGATI_TRUST_CLOUDFLARE_IP === "true"\);/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
});
