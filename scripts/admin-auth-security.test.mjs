import assert from "node:assert/strict";
import test from "node:test";

const target = process.env.BAGATI_BASE_URL;

test("unauthenticated admin store-management requests are rejected by a local BAGATI server", async () => {
  assert.ok(target, "Set BAGATI_BASE_URL to the controlled BAGATI server under test.");
  const base = new URL(target);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(base.hostname), "The test may only target a local server.");
  assert.equal(base.username || base.password || base.search || base.hash, "", "BAGATI_BASE_URL must not include credentials, query, or fragment.");

  const health = await fetch(new URL("/api/health", base), { redirect: "manual", signal: AbortSignal.timeout(5_000) });
  assert.equal(health.status, 200, "BAGATI health endpoint must respond before authorization checks");
  assert.equal(health.headers.get("x-bagati-application"), "bagati-marketplace", "Refusing to test an unidentified server");

  for (const path of [
    "/api/admin/stores",
    "/api/admin/stores/store-auth-test/review",
    "/api/admin/stores/store-auth-test/archive",
  ]) {
    const response = await fetch(new URL(path, base), {
      method: "POST",
      headers: { origin: base.origin, "content-type": "application/json" },
      body: "{}",
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    const body = await response.text();
    assert.equal(response.status, 403, `${path} should return 403 without an admin session; body: ${body.slice(0, 300)}`);
    assert.match(response.headers.get("content-type") || "", /application\/json/i);
    assert.doesNotMatch(body, /passwordHash|SESSION_SECRET|DATABASE_URL/i);
  }
});
