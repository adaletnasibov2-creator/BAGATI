import assert from "node:assert/strict";
import test from "node:test";
import { readJsonBodyLimited } from "../lib/request-json";

test("limited JSON reader accepts valid bodies within the byte cap", async () => {
  const request = new Request("http://localhost/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows: [1, 2] }),
  });
  const result = await readJsonBodyLimited(request, 64);
  assert.deepEqual(result, { ok: true, value: { rows: [1, 2] } });
});

test("limited JSON reader rejects declared and streamed oversize bodies before parsing", async () => {
  const declaredTooLarge = new Request("http://localhost/import", {
    method: "POST",
    headers: { "content-length": "65" },
    body: "{}",
  });
  assert.deepEqual(await readJsonBodyLimited(declaredTooLarge, 64), {
    ok: false, status: 413, error: "BODY_TOO_LARGE",
  });

  const streamedTooLarge = new Request("http://localhost/import", {
    method: "POST",
    body: JSON.stringify({ value: "x".repeat(80) }),
  });
  assert.deepEqual(await readJsonBodyLimited(streamedTooLarge, 64), {
    ok: false, status: 413, error: "BODY_TOO_LARGE",
  });
});

test("limited JSON reader distinguishes invalid lengths, malformed JSON, and invalid UTF-8", async () => {
  const invalidLength = new Request("http://localhost/import", {
    method: "POST",
    headers: { "content-length": "12x" },
    body: "{}",
  });
  assert.deepEqual(await readJsonBodyLimited(invalidLength, 64), {
    ok: false, status: 400, error: "INVALID_CONTENT_LENGTH",
  });

  const malformed = new Request("http://localhost/import", { method: "POST", body: "{" });
  assert.deepEqual(await readJsonBodyLimited(malformed, 64), {
    ok: false, status: 400, error: "INVALID_JSON",
  });

  const invalidUtf8 = new Request("http://localhost/import", {
    method: "POST",
    body: new Uint8Array([0xff]),
  });
  assert.deepEqual(await readJsonBodyLimited(invalidUtf8, 64), {
    ok: false, status: 400, error: "INVALID_UTF8",
  });
});

test("limited JSON reader rejects actual byte counts that disagree with Content-Length", async () => {
  const incomplete = new Request("http://localhost/import", {
    method: "POST",
    headers: { "content-length": "3" },
    body: "{}",
  });
  assert.deepEqual(await readJsonBodyLimited(incomplete, 64), {
    ok: false, status: 400, error: "INCOMPLETE_BODY",
  });

  const excess = new Request("http://localhost/import", {
    method: "POST",
    headers: { "content-length": "1" },
    body: "{}",
  });
  assert.deepEqual(await readJsonBodyLimited(excess, 64), {
    ok: false, status: 400, error: "CONTENT_LENGTH_MISMATCH",
  });
});

test("limited JSON reader preserves oversized classification when stream cancellation rejects", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(80));
    },
    cancel() {
      throw new Error("cancel failed");
    },
  });
  const request = new Request("http://localhost/import", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit);
  assert.deepEqual(await readJsonBodyLimited(request, 64), {
    ok: false, status: 413, error: "BODY_TOO_LARGE",
  });
});

test("limited JSON reader distinguishes a stream read failure from malformed JSON", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("network interrupted"));
    },
  });
  const request = new Request("http://localhost/import", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit);
  assert.deepEqual(await readJsonBodyLimited(request, 64), {
    ok: false, status: 400, error: "BODY_READ_FAILED",
  });
});
