import assert from "node:assert/strict";
import test from "node:test";
import {
  createImportJobPostHandler,
  MAX_IMPORT_JOB_CREATE_REQUEST_BYTES,
} from "../app/api/vendor/[storeId]/imports/jobs/route";

const params = { params: Promise.resolve({ storeId: "store-a" }) };
const validPayload = JSON.stringify({
  sourceName: "catalog.csv",
  sourceFormat: "csv",
  mapping: { name: "name", price: "price", category: "category" },
});

function makeHandler(options: { authorized?: boolean } = {}) {
  const created: unknown[] = [];
  const handler = createImportJobPostHandler({
    authorizeStore: async () => options.authorized === false
      ? null
      : { storeId: "store-a", user: { id: "vendor-a", role: "VENDOR" } },
    assertBulkImportEnabled: async () => undefined,
    createJob: async (input) => {
      created.push(input);
      return { id: "job-a" };
    },
  });
  return { handler, created };
}

test("job creation route rejects streamed oversized requests before parsing or persistence", async () => {
  const { handler, created } = makeHandler();
  const request = new Request("http://localhost/api/vendor/store-a/imports/jobs", {
    method: "POST",
    body: JSON.stringify({ ...JSON.parse(validPayload), extra: "x".repeat(MAX_IMPORT_JOB_CREATE_REQUEST_BYTES) }),
  });
  const response = await handler(request, params);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    error: "Sorğu icazə verilən ölçüdən böyükdür",
    code: "BODY_TOO_LARGE",
  });
  assert.equal(created.length, 0);
});

test("job creation route safely handles Content-Length mismatch, invalid UTF-8, and malformed JSON", async () => {
  const { handler, created } = makeHandler();
  const incomplete = await handler(new Request("http://localhost/import", {
    method: "POST",
    headers: { "content-length": "3" },
    body: "{}",
  }), params);
  assert.equal(incomplete.status, 400);
  assert.equal((await incomplete.json()).code, "INCOMPLETE_BODY");

  const invalidUtf8 = await handler(new Request("http://localhost/import", {
    method: "POST",
    body: new Uint8Array([0xff]),
  }), params);
  assert.equal(invalidUtf8.status, 400);
  assert.equal((await invalidUtf8.json()).code, "INVALID_UTF8");

  const malformed = await handler(new Request("http://localhost/import", {
    method: "POST",
    body: "{",
  }), params);
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).code, "INVALID_JSON");
  assert.equal(created.length, 0);
});

test("job creation route accepts a valid body without Content-Length and keeps auth ahead of parsing", async () => {
  const { handler, created } = makeHandler();
  const response = await handler(new Request("http://localhost/import", {
    method: "POST",
    body: validPayload,
  }), params);
  assert.equal(response.status, 201);
  assert.equal(created.length, 1);

  const denied = makeHandler({ authorized: false });
  const deniedResponse = await denied.handler(new Request("http://localhost/import", {
    method: "POST",
    body: "{",
  }), params);
  assert.equal(deniedResponse.status, 403);
  assert.equal(denied.created.length, 0);
});
