import assert from "node:assert/strict";
import test from "node:test";
import {
  securityEventPayloadSchema,
  hashSecurityEventId,
  securityEventTypeAllowedForSource,
  securityEventWindowStart,
  securityEventWindowBucketCount,
  SECURITY_EVENT_WINDOWS,
  securityEventPathFromRequest,
  signSecurityIngestPayload,
  verifySecurityIngestSignature,
} from "../lib/security-event-ingestion";
import { readBoundedRequestBody, readBoundedRequestBytes } from "../lib/request-body";
import { securityIntegrationConfiguration } from "../lib/security-integrations";

const secret = "local-test-security-ingestion-secret-32-bytes-minimum";
const validPayload = {
  eventId: "event-123",
  occurredAt: "2026-10-16T18:00:00.000Z",
  sourceIp: "192.0.2.10",
  path: "/wp-login.php",
  eventType: "WAF_EVENT",
  severity: "HIGH",
  action: "BLOCKED",
  ruleId: "rule-42",
};

test("security ingestion accepts a known-safe structured event", () => {
  assert.equal(securityEventPayloadSchema.safeParse(validPayload).success, true);
});

test("security ingestion rejects query strings, malformed IPs, and unexpected log fields", () => {
  assert.equal(securityEventPayloadSchema.safeParse({ ...validPayload, path: "/login?token=hidden" }).success, false);
  assert.equal(securityEventPayloadSchema.safeParse({ ...validPayload, sourceIp: "not-an-ip" }).success, false);
  assert.equal(securityEventPayloadSchema.safeParse({ ...validPayload, rawLog: "must not be accepted" }).success, false);
});

test("ingest HMAC is bound to the exact timestamp and request body", () => {
  const timestamp = "1792173600";
  const body = JSON.stringify(validPayload);
  const signature = signSecurityIngestPayload(secret, timestamp, body);
  assert.equal(verifySecurityIngestSignature({ secret, timestamp, signature, body, nowSeconds: 1792173600 }), true);
  assert.equal(verifySecurityIngestSignature({ secret, timestamp, signature, body: `${body} `, nowSeconds: 1792173600 }), false);
  assert.equal(verifySecurityIngestSignature({ secret, timestamp, signature, body, nowSeconds: 1792174000 }), false);
  assert.equal(verifySecurityIngestSignature({ secret, timestamp, signature: "0".repeat(64), body, nowSeconds: 1792173600 }), false);
  assert.equal(verifySecurityIngestSignature({ secret: "short", timestamp, signature, body, nowSeconds: 1792173600 }), false);
});

test("source event identifiers are stored as stable, non-reversible hashes", () => {
  const emailLikeId = "person@example.test";
  const hashed = hashSecurityEventId("CLOUDFLARE", emailLikeId);
  assert.equal(hashed.length, 64);
  assert.equal(hashed, hashSecurityEventId("CLOUDFLARE", emailLikeId));
  assert.notEqual(hashed, hashSecurityEventId("APACHE_MODSECURITY", emailLikeId));
  assert.equal(hashed.includes("person"), false);
});

test("Apache events are validated and persisted with source-scoped duplicate protection", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  assert.equal(securityEventTypeAllowedForSource("APACHE_MODSECURITY", "MODSECURITY_EVENT"), true);
  assert.equal(securityEventTypeAllowedForSource("APACHE_MODSECURITY", "LOGIN_FAILURE"), false);
  assert.equal(securityEventPayloadSchema.safeParse({ ...validPayload, eventType: "MODSECURITY_EVENT" }).success, true);
  assert.equal(securityEventPayloadSchema.safeParse({ ...validPayload, eventType: "MODSECURITY_EVENT", rawLog: "private" }).success, false);
  const store = readFileSync(resolve(process.cwd(), "lib/security-event-store.ts"), "utf8");
  assert.match(store, /ON CONFLICT \("source", "sourceEventId"\) DO NOTHING/);
});

test("source event types are restricted and repeated login source threshold is explicit", () => {
  assert.equal(securityEventTypeAllowedForSource("CLOUDFLARE", "WAF_EVENT"), true);
  assert.equal(securityEventTypeAllowedForSource("CLOUDFLARE", "MODSECURITY_EVENT"), false);
  assert.equal(securityEventTypeAllowedForSource("APACHE_MODSECURITY", "MODSECURITY_EVENT"), true);
});

test("security dashboard time windows use explicit server-side durations", () => {
  const now = new Date("2026-10-18T12:00:00.000Z");
  assert.deepEqual(SECURITY_EVENT_WINDOWS, ["1h", "24h", "7d", "30d"]);
  assert.equal(securityEventWindowStart("1h", now).toISOString(), "2026-10-18T11:00:00.000Z");
  assert.equal(securityEventWindowStart("24h", now).toISOString(), "2026-10-17T12:00:00.000Z");
  assert.equal(securityEventWindowStart("7d", now).toISOString(), "2026-10-11T12:00:00.000Z");
  assert.equal(securityEventWindowStart("30d", now).toISOString(), "2026-09-18T12:00:00.000Z");
});

test("security dashboard timeline uses bounded bucket counts for each supported window", () => {
  assert.deepEqual(
    SECURITY_EVENT_WINDOWS.map((window) => securityEventWindowBucketCount(window)),
    [12, 24, 7, 15],
  );
});

test("security integration status reports configuration presence without exposing secrets", () => {
  const previousApache = process.env.BAGATI_APACHE_INGEST_SECRET;
  const previousCloudflare = process.env.BAGATI_CLOUDFLARE_INGEST_SECRET;
  try {
    process.env.BAGATI_APACHE_INGEST_SECRET = "short";
    process.env.BAGATI_CLOUDFLARE_INGEST_SECRET = "x".repeat(32);
    const result = securityIntegrationConfiguration();
    assert.equal(result.apacheIngestSecretConfigured, false);
    assert.equal(result.cloudflareRelaySecretConfigured, true);
    assert.equal(JSON.stringify(result).includes("x".repeat(32)), false);
  } finally {
    if (previousApache === undefined) delete process.env.BAGATI_APACHE_INGEST_SECRET;
    else process.env.BAGATI_APACHE_INGEST_SECRET = previousApache;
    if (previousCloudflare === undefined) delete process.env.BAGATI_CLOUDFLARE_INGEST_SECRET;
    else process.env.BAGATI_CLOUDFLARE_INGEST_SECRET = previousCloudflare;
  }
});

test("application event IP collection requires explicit trusted Cloudflare proxy configuration", () => {
  const prior = process.env.BAGATI_TRUST_CLOUDFLARE_IP;
  const request = new Request("https://local.test", { headers: { "cf-connecting-ip": "192.0.2.10" } });
  try {
    delete process.env.BAGATI_TRUST_CLOUDFLARE_IP;
    assert.equal(securityEventPathFromRequest(request), null);
    process.env.BAGATI_TRUST_CLOUDFLARE_IP = "true";
    assert.equal(securityEventPathFromRequest(request), "192.0.2.10");
    assert.equal(securityEventPathFromRequest(new Request("https://local.test", { headers: { "cf-connecting-ip": "spoofed" } })), null);
  } finally {
    if (prior === undefined) delete process.env.BAGATI_TRUST_CLOUDFLARE_IP;
    else process.env.BAGATI_TRUST_CLOUDFLARE_IP = prior;
  }
});

test("bounded body reader limits content length and streamed payload size", async () => {
  const declaredLarge = new Request("https://local.test", {
    method: "POST",
    headers: { "content-length": "5" },
    body: "12345",
  });
  await assert.rejects(readBoundedRequestBody(declaredLarge, 4), /BODY_TOO_LARGE/);

  const streamed = new Request("https://local.test", { method: "POST", body: "12345" });
  await assert.rejects(readBoundedRequestBody(streamed, 4), /BODY_TOO_LARGE/);

  const valid = new Request("https://local.test", { method: "POST", body: "safe" });
  assert.equal(await readBoundedRequestBody(valid, 4), "safe");
});

test("streaming request byte limit protects bodies without a content-length header", async () => {
  const oversized = new Request("https://local.test", {
    method: "POST",
    body: "12345",
  });
  assert.equal(oversized.headers.get("content-length"), null);
  await assert.rejects(readBoundedRequestBytes(oversized, 4), /BODY_TOO_LARGE/);

  const form = new FormData();
  form.set("file", new Blob(["safe-image-data"], { type: "image/png" }), "image.png");
  const request = new Request("https://local.test", { method: "POST", body: form });
  const bytes = await readBoundedRequestBytes(request, 1024);
  const formBody = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(formBody).set(bytes);
  const reconstructed = await new Request(request.url, { method: "POST", headers: request.headers, body: formBody }).formData();
  assert.equal((reconstructed.get("file") as File).name, "image.png");
});
