/**
 * GOOGLE-PREFETCH-1: the Google start route is never prefetched (plain <a>), and the route itself answers prefetch /
 * Next.js router requests with an empty 204 (no cookie, no rate-limit use, no redirect). Unit tests: static source
 * checks plus the real route handler with real Request objects. No network: the start route only builds the Google
 * URL. Test order matters: the first test runs before anything else uses the in-process rate-limit bucket.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET as startGoogleOAuth } from "../app/api/auth/google/start/route";
import { consumeAuthProcessRateLimit } from "../lib/auth-rate-limit";
import { isPrefetchOrRouterRequest } from "../lib/prefetch-request";

// Throwaway test values (read when the route runs).
process.env.SESSION_SECRET ??= "google-prefetch-1-unit-test-secret-0123456789abcdef";
process.env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "server-only-test-value";
process.env.APP_BASE_URL = "http://localhost:3000";
Object.assign(process.env, { NODE_ENV: "development" });

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const START = "http://localhost:3000/api/auth/google/start?intent=customer&mode=login&next=%2Fcart";
const start = (headers: Record<string, string> = {}, url = START) => startGoogleOAuth(new NextRequest(url, { headers }));

/** Headers the Next.js router / browsers send for prefetches and client-side route fetches. */
const PREFETCH_HEADER_SETS: Array<Record<string, string>> = [
  { rsc: "1", "next-router-prefetch": "1" }, // <Link> viewport / hover prefetch
  { "next-router-prefetch": "1" },
  { "next-router-segment-prefetch": "/_tree" },
  { rsc: "1" }, // client-side navigation fetch from a <Link> click
  { "sec-purpose": "prefetch" }, // Chrome speculation rules / <link rel=prefetch>
  { "sec-purpose": "prefetch;prerender" },
  { purpose: "prefetch" },
  { "x-purpose": "ignored", purpose: "Prefetch" },
];

async function assertQuiet(response: Response, label: string) {
  assert.equal(response.status, 204, label);
  assert.equal(response.headers.get("location"), null, `${label}: no redirect`);
  assert.equal(response.headers.get("set-cookie"), null, `${label}: no cookie`);
  assert.equal(response.headers.get("cache-control"), "no-store", label);
  assert.equal(await response.text(), "", `${label}: empty body`);
}

test("1000 prefetches use no rate-limit counter: a real start afterwards still goes to Google (limit is 600/min)", async () => {
  for (let i = 0; i < 1000; i += 1) {
    const headers = PREFETCH_HEADER_SETS[i % PREFETCH_HEADER_SETS.length];
    const response = await start(headers);
    if (i < PREFETCH_HEADER_SETS.length) await assertQuiet(response, JSON.stringify(headers));
    else assert.equal(response.status, 204);
  }
  const real = await start({ "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-user": "?1" });
  assert.equal(real.status, 307);
  assert.equal(new URL(real.headers.get("location") ?? "").hostname, "accounts.google.com");
  assert.ok(real.cookies.get("bagati_google_oauth")?.value, "the real click gets the OAuth state cookie as before");
});

test("a normal request (no prefetch headers) behaves exactly as before for every intent/mode", async () => {
  const plain = await start();
  assert.equal(plain.status, 307);
  const location = new URL(plain.headers.get("location") ?? "");
  assert.equal(location.hostname, "accounts.google.com");
  assert.equal(location.searchParams.get("client_id"), "client-id.apps.googleusercontent.com");
  const cookie = plain.cookies.get("bagati_google_oauth");
  assert.ok(cookie?.value);
  assert.equal(cookie?.httpOnly, true);
  assert.equal(plain.headers.get("cache-control"), "no-store");
  // The refusals that existed before still answer real requests.
  const noTerms = await start({}, "http://localhost:3000/api/auth/google/start?intent=customer&mode=register&next=%2Fcart");
  assert.equal(new URL(noTerms.headers.get("location") ?? "").searchParams.get("oauth"), "terms-required");
  const sellerRegister = await start({}, "http://localhost:3000/api/auth/google/start?intent=vendor&mode=register");
  assert.equal(new URL(sellerRegister.headers.get("location") ?? "").pathname, "/vendor/login");
  const bad = await start({}, "http://localhost:3000/api/auth/google/start?intent=admin&mode=login");
  assert.equal(new URL(bad.headers.get("location") ?? "").searchParams.get("oauth"), "invalid");
  // A prefetch of a refusal URL is just as quiet.
  await assertQuiet(await start({ rsc: "1", "next-router-prefetch": "1" }, "http://localhost:3000/api/auth/google/start?intent=admin&mode=login"), "prefetch of an invalid start");
});

test("with the rate-limit bucket full, a real start is rate-limited but a prefetch is still an empty 204", async () => {
  while (consumeAuthProcessRateLimit("google-oauth-start", 600, 60_000)) { /* fill this process's bucket */ }
  const real = await start();
  assert.equal(new URL(real.headers.get("location") ?? "").searchParams.get("oauth"), "rate-limited");
  await assertQuiet(await start({ rsc: "1", "next-router-prefetch": "1" }), "prefetch while limited");
});

test("isPrefetchOrRouterRequest: prefetch / router markers yes, real navigations no", () => {
  for (const headers of PREFETCH_HEADER_SETS) assert.equal(isPrefetchOrRouterRequest(new Headers(headers)), true, JSON.stringify(headers));
  const realNavigations: Array<Record<string, string>> = [
    {},
    { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-user": "?1", accept: "text/html" },
    { rsc: "0" },
    { "sec-purpose": "" },
    { purpose: "prefetchx" },
    { "sec-purpose": "notprefetch" },
  ];
  for (const headers of realNavigations) assert.equal(isPrefetchOrRouterRequest(new Headers(headers)), false, JSON.stringify(headers));
});

test("the guard is the route's FIRST step: before any cookie, rate limit, session read or redirect", () => {
  const route = read("app/api/auth/google/start/route.ts");
  const body = route.slice(route.indexOf("export async function GET(request: NextRequest) {"));
  const guard = body.indexOf("if (isPrefetchOrRouterRequest(request.headers)) {");
  assert.ok(guard > 0);
  for (const later of ["oauthResponseOrigin(", "NextResponse.redirect(", "consumeAuthProcessRateLimit(", "consumeAuthRateLimit(", "currentUser(", "cookies.set("]) {
    assert.ok(body.indexOf(later) > guard, `${later} comes after the guard`);
  }
  assert.match(body, /return new NextResponse\(null, \{ status: 204, headers: \{ "Cache-Control": "no-store",/);
});

function appFiles() {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) files.push(relative(root, full).replace(/\\/g, "/"));
    }
  };
  for (const dir of ["app", "components", "lib"]) walk(resolve(root, dir));
  return files;
}

test("every link to /api/auth/google/start is a plain <a> or a <Link prefetch={false}>", () => {
  const linking = appFiles().filter(path => path !== "app/api/auth/google/start/route.ts" && read(path).includes("/api/auth/google/start"));
  assert.deepEqual(linking, ["components/google-oauth-button.tsx"], "the one shared button (login, register, seller login, both security pages)");
  for (const path of linking) {
    const source = read(path);
    const tags = [...source.matchAll(/<(\w+)\s+href=\{?[`"']\/api\/auth\/google\/start[^>]*>/g)];
    assert.ok(tags.length > 0, path);
    for (const [tag, name] of tags) {
      assert.ok(name === "a" || (name === "Link" && /prefetch=\{false\}/.test(tag)), `${path}: ${tag.slice(0, 80)}`);
    }
    assert.doesNotMatch(source, /<Link\s+href=\{`\/api\/auth\/google\/start/);
  }
});

test("the button keeps its href, classes, texts, and the /register consent gate (disabled button until ticked)", () => {
  const source = read("components/google-oauth-button.tsx");
  assert.match(source, /<a href=\{`\/api\/auth\/google\/start\?\$\{query\.toString\(\)\}`\} className="flex w-full items-center justify-center gap-3 rounded-full border border-line bg-white px-5 py-3\.5 font-medium text-ink transition hover:bg-slate-50">\n      <GoogleMark\/>\n      \{mode === "link" \? "Google hesabını bağla" : "Google ilə davam et"\}\n    <\/a>\}/);
  assert.match(source, /\{termsGate && !termsGate\.accepted \? <button type="button" onClick=\{termsGate\.onBlocked\} aria-disabled="true" className="flex w-full items-center justify-center gap-3 rounded-full border border-line bg-white px-5 py-3\.5 font-medium text-ink opacity-60 transition">\n      <GoogleMark\/>\n      Google ilə davam et\n    <\/button> :/);
  assert.match(source, /if \(termsGate\?\.accepted\) query\.set\("acceptTerms", "1"\);/);
  // Every page still renders the same shared button.
  for (const [path, usage] of [
    ["components/login-form.tsx", '<GoogleOAuthButton intent="customer" mode="login"'],
    ["components/register-form.tsx", '<GoogleOAuthButton intent="customer" mode="register"'],
    ["components/vendor-login-form.tsx", '<GoogleOAuthButton intent="vendor" mode="login"'],
    ["app/(customer)/account/[...section]/page.tsx", '<GoogleOAuthButton intent="customer" mode="link"'],
    ["app/vendor/security/page.tsx", '<GoogleOAuthButton intent="vendor" mode="link"'],
  ]) assert.ok(read(path).includes(usage), path);
});

test("no new visible text: the button's texts are the same as before", () => {
  const source = read("components/google-oauth-button.tsx");
  const az = /[əğıöüşçƏĞİÖÜŞÇ]/;
  const added = source.split("\n").filter(line => line.includes("GOOGLE-PREFETCH-1") || line.includes("prefetched") || line.includes("plain <a>"));
  for (const line of added) assert.doesNotMatch(line, az, line);
  assert.doesNotMatch(read("lib/prefetch-request.ts"), az);
});
