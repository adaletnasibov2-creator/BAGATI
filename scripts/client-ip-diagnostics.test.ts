import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  CLOUDFLARE_IPV4_RANGES, CLOUDFLARE_IPV6_RANGES, clientIpDiagnostics, isCloudflareIp, normalizeIp, parseForwardedFor, parseForwardedHeader,
} from "../lib/client-ip-diagnostics";
import { trustedCloudflareClientIp } from "../lib/trusted-proxy";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

test("the client IP card is ADMIN only, read-only, request-specific and never cached", () => {
  const route = read("app/api/admin/system/route.ts");
  const auth = route.indexOf('const admin = await requireRole("ADMIN");');
  const card = route.indexOf('searchParams.get("card") === "client-ip"');
  assert.ok(auth > 0 && card > auth, "role check runs before the card");
  assert.match(route, /clientIpDiagnostics\(request\.headers, process\.env\.BAGATI_TRUST_CLOUDFLARE_IP === "true"\)/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  const lib = read("lib/client-ip-diagnostics.ts");
  assert.doesNotMatch(lib, /prisma|process\.env/, "pure: no database, no environment");
  assert.match(read("components/admin-system-status.tsx"), /spec\("client-ip", "Müştəri IP başlıqları", ClientIpBody\)/);
});

test("Cloudflare ranges match the published list and CIDR checks work for IPv4 and IPv6", () => {
  assert.equal(CLOUDFLARE_IPV4_RANGES.length, 15);
  assert.equal(CLOUDFLARE_IPV6_RANGES.length, 7);
  for (const ip of ["173.245.48.1", "104.16.0.0", "104.23.255.255", "162.159.1.2", "131.0.75.255", "2606:4700::6810:1", "2a06:98c7:ffff::1", "2400:cb00:abcd::1"]) {
    assert.equal(isCloudflareIp(ip), true, ip);
  }
  for (const ip of ["104.24.0.0", "203.0.113.5", "104.15.255.255", "131.0.76.0", "2a06:98c8::1", "2001:db8::1", "::ffff:104.16.0.1", "not-an-ip", ""]) {
    assert.equal(isCloudflareIp(ip), ip === "104.24.0.0", ip);
  }
});

test("addresses are normalized from header syntax", () => {
  assert.equal(normalizeIp(" 203.0.113.5 "), "203.0.113.5");
  assert.equal(normalizeIp("203.0.113.5:443"), "203.0.113.5");
  assert.equal(normalizeIp('"[2001:db8::1]:443"'), "2001:db8::1");
  assert.equal(normalizeIp("unknown"), null);
  assert.deepEqual(parseForwardedFor("203.0.113.5, 162.158.1.1 ,junk"), ["203.0.113.5", "162.158.1.1", null]);
  assert.deepEqual(parseForwardedHeader('for=203.0.113.5;proto=https, for="[2001:db8::1]:443";by=x, proto=http'), ["203.0.113.5", "2001:db8::1", null]);
});

test("diagnostics: flag off never yields an IP; flag on uses CF-Connecting-IP only; values are masked", () => {
  const headers = new Headers({
    "cf-connecting-ip": "203.0.113.57",
    "x-forwarded-for": "203.0.113.57, 162.158.10.20",
    // Phase 1 of the Security Center: in production X-Real-IP carries the real client IP (Nginx overwrites it); a
    // different value now makes the client IP unknown, so the fixture uses the matching address.
    "x-real-ip": "203.0.113.57",
  });
  const off = clientIpDiagnostics(headers, false);
  assert.equal(off.flagEnabled, false);
  assert.equal(off.ipWithFlagOff, null);
  assert.equal(off.ipWithFlagOn, "203.0.*.*");
  assert.equal(off.socketAddressAvailable, false);
  assert.deepEqual(off.forwardedChain, [{ masked: "203.0.*.*", cloudflare: false }, { masked: "162.158.*.*", cloudflare: true }]);
  assert.equal(off.rightmostHopCloudflare, true);
  assert.equal(off.cfConnectingIpMatchesLeftmostXff, true);
  assert.deepEqual(off.headers.map((h) => [h.name, h.present]), [["cf-connecting-ip", true], ["true-client-ip", false], ["x-forwarded-for", true], ["x-real-ip", true], ["forwarded", false]]);
  assert.doesNotMatch(JSON.stringify(off), /203\.0\.113\.57|162\.158\.10\.20/, "no full address leaves the module");
  // Matches the production helper exactly.
  assert.equal(trustedCloudflareClientIp(headers, false), null);
  assert.equal(trustedCloudflareClientIp(headers, true), "203.0.113.57");
  assert.equal(off.cfRealIpMismatch, false);
  const mismatch = new Headers({ "cf-connecting-ip": "203.0.113.57", "x-real-ip": "162.158.10.20" });
  assert.equal(clientIpDiagnostics(mismatch, true).cfRealIpMismatch, true);
  assert.equal(clientIpDiagnostics(mismatch, true).ipWithFlagOn, null, "mismatch: no trusted IP");
});

test("diagnostics expose a direct-to-origin request: no Cloudflare hop, spoofable header", () => {
  const spoofed = clientIpDiagnostics(new Headers({ "cf-connecting-ip": "198.51.100.9", "x-forwarded-for": "198.51.100.9, 203.0.113.200" }), true);
  assert.equal(spoofed.rightmostHopCloudflare, false, "the hop the origin proxy saw is not Cloudflare");
  assert.equal(spoofed.ipWithFlagOn, "198.51.*.*", "today's helper would trust it anyway");
  const none = clientIpDiagnostics(new Headers(), true);
  assert.equal(none.ipWithFlagOn, null);
  assert.equal(none.rightmostHopCloudflare, null);
  assert.equal(none.cfConnectingIpMatchesLeftmostXff, null);
  assert.deepEqual(clientIpDiagnostics(new Headers({ "cf-connecting-ip": "a, b" }), true).headers[0].values, ["yanlış dəyər"]);
});
