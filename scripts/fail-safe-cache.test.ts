import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createFailSafeLoader } from "../lib/fail-safe-cache";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

function harness(load: () => Promise<string>) {
  let now = 1_000_000;
  const logs: string[] = [];
  const loader = createFailSafeLoader({ label: "t", ttlMs: 30_000, retryAfterMs: 5_000, logIntervalMs: 60_000, load, fallback: () => "DEFAULT", clock: () => now, log: (line) => logs.push(line) });
  return { loader, logs, advance: (ms: number) => { now += ms; } };
}

test("serves the cached value inside the TTL and reloads after it", async () => {
  let calls = 0;
  const h = harness(async () => `v${++calls}`);
  assert.equal(await h.loader.get(), "v1");
  h.advance(29_999);
  assert.equal(await h.loader.get(), "v1");
  h.advance(2);
  assert.equal(await h.loader.get(), "v2");
  h.loader.invalidate();
  assert.equal(await h.loader.get(), "v3", "invalidate forces a reload");
});

test("a database error never throws: last good value first, defaults when there is none", async () => {
  let fail = true;
  const h = harness(async () => { if (fail) throw Object.assign(new Error(["connection refused ", "postgres", "://user:pw@host/db"].join("")), { code: "P1001" }); return "fresh"; });
  assert.equal(await h.loader.get(), "DEFAULT", "no last good value yet");
  fail = false;
  h.advance(5_001);
  assert.equal(await h.loader.get(), "fresh");
  fail = true;
  h.advance(30_001);
  assert.equal(await h.loader.get(), "fresh", "last good value survives an outage");
  // The log line names the error class and code only, never the message (which can contain a URL).
  assert.ok(h.logs.length >= 1);
  for (const line of h.logs) {
    assert.doesNotMatch(line, /postgres|pw@|connection refused/);
    assert.match(line, /"event":"cached_read.failed","label":"t","error":"Error","code":"P1001"/);
  }
});

test("errors are logged at most once per minute, and retries wait 5 seconds", async () => {
  let attempts = 0;
  const h = harness(async () => { attempts++; throw new Error("down"); });
  await h.loader.get();
  await h.loader.get();
  assert.equal(attempts, 1, "within retryAfterMs the fallback is served without a new query");
  for (let i = 0; i < 10; i++) { h.advance(5_001); await h.loader.get(); }
  assert.equal(attempts, 11);
  assert.equal(h.logs.length, 1, "one log line in the first minute");
  h.advance(10_000);
  await h.loader.get();
  assert.equal(h.logs.length, 2, "logged again after a minute");
});

test("concurrent callers share one load", async () => {
  let calls = 0;
  let release!: (value: string) => void;
  const h = harness(() => { calls++; return new Promise<string>((resolve) => { release = resolve; }); });
  const both = Promise.all([h.loader.get(), h.loader.get()]);
  release("once");
  assert.deepEqual(await both, ["once", "once"]);
  assert.equal(calls, 1);
});

test("getSiteSettings is cached and fail-safe; public pages and metadata use it; the admin save invalidates", () => {
  const lib = read("lib/site-settings.ts");
  assert.match(lib, /createFailSafeLoader\(\{[\s\S]*?ttlMs: SITE_SETTINGS_CACHE_TTL_MS,[\s\S]*?fallback: \(\) => SITE_SETTINGS_DEFAULTS,/);
  assert.match(lib, /SITE_SETTINGS_CACHE_TTL_MS = 30_000/);
  assert.match(read("app/layout.tsx"), /const settings = await getSiteSettings\(\);/);
  assert.doesNotMatch(read("app/layout.tsx"), /prisma/);
  assert.doesNotMatch(read("app/(customer)/layout.tsx"), /siteSettings\.find/);
  const route = read("app/api/admin/site-settings/route.ts");
  assert.ok(route.indexOf("invalidateSiteSettingsCache();") > route.indexOf("prisma.$transaction("), "invalidated after the committed save");
});
