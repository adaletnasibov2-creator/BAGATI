import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/health/route";
import { readinessResponse } from "../lib/readiness";

test("health endpoint reports process liveness without a database dependency", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("readiness reports the database probe without leaking the failure", async () => {
  const ready = await readinessResponse(async () => 1);
  assert.equal(ready.status, 200);
  assert.equal(ready.headers.get("cache-control"), "no-store");
  assert.deepEqual(await ready.json(), { status: "ready", storage: "unconfigured" });

  const unavailable = await readinessResponse(async () => {
    throw new Error("database password=secret host=db.internal");
  });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { status: "unavailable" });
});
