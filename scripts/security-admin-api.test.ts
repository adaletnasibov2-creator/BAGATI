import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { canTransition, fillMinuteSeries, INCIDENT_STATUSES, INCIDENT_TRANSITIONS, sumPoints, transitionFields } from "../lib/security-monitoring/admin";
import { requireSecurityPermission, securityPermissionsFor } from "../lib/security-monitoring/permissions";
import { displayIp, mergeRepeatedIps } from "../lib/security-event-store";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const ascending = (source: string, needles: string[]) => {
  const positions = needles.map((needle) => source.indexOf(needle));
  return positions.every((position) => position >= 0) && positions.every((position, index) => index === 0 || position > positions[index - 1]);
};

test("permission hook: ADMIN holds view, respond and rules; other roles hold none", () => {
  assert.deepEqual(securityPermissionsFor("ADMIN"), ["security.view", "security.respond", "security.rules"]);
  for (const role of ["CUSTOMER", "VENDOR"] as const) {
    assert.deepEqual(securityPermissionsFor(role), []);
    assert.equal(requireSecurityPermission({ role }, "security.view"), false);
  }
  assert.equal(requireSecurityPermission({ role: "ADMIN" }, "security.rules"), true);
});

test("incident transitions: closed incidents only reopen; reopening clears the marks; closing sets resolvedAt", () => {
  assert.deepEqual(INCIDENT_STATUSES, ["OPEN", "ACKNOWLEDGED", "RESOLVED", "FALSE_POSITIVE"]);
  assert.equal(canTransition("OPEN", "RESOLVED"), true);
  assert.equal(canTransition("RESOLVED", "ACKNOWLEDGED"), false);
  assert.equal(canTransition("FALSE_POSITIVE", "RESOLVED"), false);
  assert.equal(canTransition("RESOLVED", "OPEN"), true);
  for (const status of INCIDENT_STATUSES) assert.ok(!INCIDENT_TRANSITIONS[status].includes(status), "no self transition");
  const now = new Date("2026-11-14T10:00:00.000Z");
  assert.deepEqual(transitionFields("OPEN", "a1", now), { status: "OPEN", acknowledgedAt: null, acknowledgedById: null, resolvedAt: null, resolvedById: null });
  assert.deepEqual(transitionFields("FALSE_POSITIVE", "a1", now), { status: "FALSE_POSITIVE", resolvedAt: now, resolvedById: "a1" });
});

test("live series: exactly 60 minutes ending at the current minute, gaps are zero", () => {
  const now = new Date("2026-11-14T10:30:42.000Z");
  const series = fillMinuteSeries([
    { bucketStart: new Date("2026-11-14T10:30:00.000Z"), requests: 5, status5xx: 1 },
    { bucketStart: new Date("2026-11-14T09:31:00.000Z"), requests: 2, notFound: 2 },
    { bucketStart: new Date("2026-11-14T09:30:00.000Z"), requests: 99 },
  ], now);
  assert.equal(series.length, 60);
  assert.equal(series[0].minute, "2026-11-14T09:31:00.000Z");
  assert.equal(series[59].minute, "2026-11-14T10:30:00.000Z");
  assert.equal(series[30].requests, 0);
  const total = sumPoints(series);
  assert.deepEqual([total.requests, total.status5xx, total.notFound], [7, 1, 2], "the row outside the window is ignored");
});

test("display IPs are always masked; repeated sources group by mask", () => {
  assert.equal(displayIp({ sourceIp: "203.0.113.7", sourceIpMasked: null }), "203.0.*.*");
  assert.equal(displayIp({ sourceIp: null, sourceIpMasked: "203.0.*.*" }), "203.0.*.*");
  assert.equal(displayIp({ sourceIp: null, sourceIpMasked: null }), null);
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 14, 10, minute));
  const merged = mergeRepeatedIps([
    { sourceIp: "203.0.113.7", sourceIpMasked: "203.0.*.*", count: 3, latestAt: at(1), sources: ["APPLICATION"], eventTypes: ["LOGIN_FAILURE"], critical: 0, high: 0 },
    { sourceIp: "203.0.9.9", sourceIpMasked: null, count: 2, latestAt: at(5), sources: ["CLOUDFLARE"], eventTypes: ["WAF_EVENT"], critical: 0, high: 1 },
    { sourceIp: "198.51.100.1", sourceIpMasked: "198.51.*.*", count: 9, latestAt: at(2), sources: ["APPLICATION"], eventTypes: ["LOGIN_FAILURE"], critical: 0, high: 0 },
  ]);
  assert.deepEqual(merged.map((row) => [row.sourceIp, row.count, row.high, row.sources.length]), [["203.0.*.*", 5, 1, 2], ["198.51.*.*", 9, 0, 1]]);
  assert.equal(merged[0].latestAt.toISOString(), at(5).toISOString());
  assert.ok(JSON.stringify(merged).match(/\d+\.\d+\.\d+\.\d+/) === null, "no full IPv4 in the output");
});

test("API order: writes check same-origin, then ADMIN, then the permission, then read the bounded body", () => {
  const http = read("lib/security-monitoring/http.ts");
  assert.ok(ascending(http, ["csrfRejection(request)", 'requireRole("ADMIN")', "requireSecurityPermission(admin, permission)"]), "authorizeSecurityAdmin order");
  assert.match(http, /readJsonBodyLimited\(request, SECURITY_ADMIN_BODY_BYTES\)/);
  const routes: Array<[string, string, string, boolean]> = [
    ["app/api/admin/security/live/route.ts", "GET", "security.view", false],
    ["app/api/admin/security/incidents/route.ts", "GET", "security.view", false],
    ["app/api/admin/security/incidents/[id]/route.ts", "handlePATCH", "security.respond", true],
    ["app/api/admin/security/incidents/[id]/notes/route.ts", "handlePOST", "security.respond", true],
    ["app/api/admin/security/rules/route.ts", "GET", "security.view", false],
    ["app/api/admin/security/rules/[key]/route.ts", "handlePUT", "security.rules", true],
    ["app/api/admin/security/rules/[key]/route.ts", "handleDELETE", "security.rules", true],
  ];
  for (const [path, handler, permission, write] of routes) {
    const source = read(path);
    const body = source.slice(source.indexOf(`function ${handler}(`));
    assert.ok(body.length < source.length, `${path}: ${handler}`);
    const authorize = `authorizeSecurityAdmin(request, "${permission}", { write: ${write} })`;
    assert.ok(body.trimStart().split("\n").slice(0, 3).join("\n").includes(authorize), `${path} ${handler}: authorizes first with ${permission}`);
    if (write) assert.ok(ascending(body, [authorize, "readSecurityBody(request)", ".safeParse(body.value)"]), `${path} ${handler}: body after auth`);
  }
  assert.doesNotMatch(read("app/api/admin/security/events/route.ts"), /sourceIp: event\.sourceIp/, "events API does not re-expose raw IPs");
});

test("a cross-site write is rejected before the session is looked up", async () => {
  const { authorizeSecurityAdmin } = await import("../lib/security-monitoring/http");
  const request = new Request("https://bagati.az/api/admin/security/rules/server_error_spike", {
    method: "PUT", headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site", host: "bagati.az" },
  });
  // requireRole reads cookies() and would throw outside a Next.js request: reaching a response proves it never ran.
  const result = await authorizeSecurityAdmin(request, "security.rules", { write: true });
  assert.ok("response" in result);
  assert.equal(result.response.status, 403);
});
