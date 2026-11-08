import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { crossSiteRequestReason, csrfRejection, isCsrfExemptApiPath, trustedOrigins } from "../lib/csrf";
import { middleware } from "../middleware";

const production = { production: true, appBaseUrl: "https://shopbagati.com" };
const development = { production: false, appBaseUrl: "http://localhost:3000" };

function requestWith(method: string, headers: Record<string, string>, url = "http://shopbagati.com/api/cart/items") {
  return { method, headers: new Headers(headers), url };
}

test("trusted origins come from the request host and the configured public origin, never from the reconstructed protocol", () => {
  const behindProxy = trustedOrigins(requestWith("POST", { host: "shopbagati.com" }), production);
  assert.ok(behindProxy.has("https://shopbagati.com"));
  assert.equal(behindProxy.has("http://shopbagati.com"), false, "plain http is not trusted for public hosts in production");
  const local = trustedOrigins(requestWith("POST", { host: "localhost:4000" }, "http://localhost:4000/api/x"), production);
  assert.ok(local.has("http://localhost:4000"), "loopback hosts may use http even in production mode");
  const dev = trustedOrigins(requestWith("POST", { host: "192.168.1.20:3000" }, "http://192.168.1.20:3000/api/x"), development);
  assert.ok(dev.has("http://192.168.1.20:3000"));
  assert.ok(dev.has("http://localhost:3000"));
  const malformed = trustedOrigins(requestWith("POST", { host: "evil.example/@shopbagati.com" }, "not a url"), { production: true, appBaseUrl: "::bad::" });
  assert.equal(malformed.size, 0);
  assert.ok(behindProxy.has("https://www.shopbagati.com"), "www is the existing canonical alias of shopbagati.com");
  assert.equal(behindProxy.has("https://evil.example"), false);
});

test("safe methods pass and unsafe requests honour Origin, Referer, and Fetch Metadata", () => {
  assert.equal(crossSiteRequestReason(requestWith("GET", { origin: "https://evil.example" }), production), null);
  assert.equal(crossSiteRequestReason(requestWith("HEAD", { origin: "https://evil.example" }), production), null);
  assert.equal(crossSiteRequestReason(requestWith("OPTIONS", { origin: "https://evil.example" }), production), null);
  const host = { host: "shopbagati.com" };
  assert.equal(crossSiteRequestReason(requestWith("POST", { ...host, origin: "https://shopbagati.com" }), production), null);
  assert.equal(crossSiteRequestReason(requestWith("POST", { ...host, origin: "HTTPS://ShopBagati.com" }), production), null);
  assert.equal(crossSiteRequestReason(requestWith("PATCH", { ...host, origin: "https://evil.example" }), production), "origin-mismatch");
  assert.equal(crossSiteRequestReason(requestWith("DELETE", { ...host, origin: "null" }), production), "origin-opaque");
  assert.equal(crossSiteRequestReason(requestWith("POST", { ...host, origin: "http://shopbagati.com" }), production), "origin-mismatch");
  assert.equal(crossSiteRequestReason(requestWith("POST", { ...host, origin: "https://shopbagati.com", "sec-fetch-site": "cross-site" }), production), "fetch-metadata");
  assert.equal(crossSiteRequestReason(requestWith("POST", { ...host, origin: "https://shopbagati.com", "sec-fetch-site": "same-origin" }), production), null);
  assert.equal(crossSiteRequestReason(requestWith("POST", { ...host, origin: "https://shopbagati.com", "sec-fetch-site": "same-site" }), production), null);
  assert.equal(crossSiteRequestReason(requestWith("POST", { ...host, origin: "https://www.shopbagati.com", "sec-fetch-site": "same-site" }), production), null);
  assert.equal(crossSiteRequestReason(requestWith("POST", { ...host, origin: "https://evil.example", "sec-fetch-site": "same-site" }), production), "origin-mismatch");
  assert.equal(crossSiteRequestReason(requestWith("POST", { ...host, origin: "https://shopbagati.com", "sec-fetch-site": "none" }), production), null);
  assert.equal(crossSiteRequestReason(requestWith("POST", { ...host, "sec-fetch-site": "none" }), production), "origin-absent");
  assert.equal(crossSiteRequestReason(requestWith("POST", { ...host, origin: "https://shopbagati.com.evil.example" }), production), "origin-mismatch");
  assert.equal(crossSiteRequestReason(requestWith("POST", { ...host, origin: "not-a-url" }), production), "origin-mismatch");
  assert.equal(crossSiteRequestReason(requestWith("POST", { ...host, referer: "https://shopbagati.com/checkout" }), production), null);
  assert.equal(crossSiteRequestReason(requestWith("POST", { ...host, referer: "https://evil.example/" }), production), "referer-mismatch");
  assert.equal(crossSiteRequestReason(requestWith("POST", { ...host, referer: "not a url" }), production), "referer-invalid");
  assert.equal(crossSiteRequestReason(requestWith("POST", host), production), "origin-absent");
  const loopbackBrowser = requestWith("POST", {
    host: "127.0.0.1:3001",
    origin: "http://127.0.0.1:3001",
    "sec-fetch-site": "same-origin",
  }, "http://localhost:3001/api/auth/logout");
  assert.equal(crossSiteRequestReason(loopbackBrowser, production), null, "Host wins when Next rewrites request.url to localhost");
  assert.equal(crossSiteRequestReason(requestWith("POST", {
    host: "127.0.0.1:3001",
    origin: "http://localhost:3001",
  }, "http://localhost:3001/api/auth/logout"), production), "origin-mismatch", "a rewritten request.url must not make localhost and 127.0.0.1 interchangeable");
  assert.equal(crossSiteRequestReason(requestWith("POST", {
    host: "localhost:3001",
    origin: "http://127.0.0.1:3001",
  }, "http://localhost:3001/api/auth/logout"), production), "origin-mismatch");
  assert.equal(crossSiteRequestReason(requestWith("POST", {
    host: "amon:3001",
    origin: "http://amon:3001",
    "sec-fetch-site": "same-origin",
  }, "http://localhost:3001/api/auth/logout"), production), null, "a single-label local machine name may use HTTP");
  assert.equal(crossSiteRequestReason(requestWith("POST", {
    host: "192.168.1.20:3001",
    origin: "http://192.168.1.20:3001",
  }, "http://localhost:3001/api/auth/logout"), production), null);
  assert.equal(crossSiteRequestReason(requestWith("POST", {
    host: "shopbagati.com",
    origin: "http://shopbagati.com",
  }), production), "origin-mismatch");
  assert.equal(crossSiteRequestReason(requestWith("POST", {
    host: "shopbagati.com",
    origin: "https://shopbagati.com",
    "x-forwarded-host": "evil.example",
    "x-forwarded-proto": "http",
  }), production), null);
});

test("csrf rejection is a cacheless JSON 403 and only signed ingestion and health are exempt", async () => {
  const rejected = csrfRejection(requestWith("POST", { host: "shopbagati.com", origin: "https://evil.example" }), production);
  assert.ok(rejected);
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get("cache-control"), "no-store");
  assert.deepEqual(await rejected.json(), { error: "Sorğu mənşəyi yoxlanılmadı.", code: "CROSS_SITE_REQUEST" });
  assert.equal(csrfRejection(requestWith("POST", { host: "shopbagati.com", origin: "https://shopbagati.com" }), production), null);
  assert.equal(isCsrfExemptApiPath("/api/security/ingest/apache"), true);
  assert.equal(isCsrfExemptApiPath("/api/health"), true);
  assert.equal(isCsrfExemptApiPath("/api/payments/epoint/callback"), true);
  assert.equal(isCsrfExemptApiPath("/api/payments/epoint/initiate"), false);
  assert.equal(isCsrfExemptApiPath("/api/auth/login"), false);
});

test("middleware protects unsafe API methods and leaves pages, safe methods, and signed ingestion alone", async () => {
  const previous = { nodeEnv: process.env.NODE_ENV, appBaseUrl: process.env.APP_BASE_URL };
  Object.assign(process.env, { NODE_ENV: "production" });
  process.env.APP_BASE_URL = "https://shopbagati.com";
  try {
    const make = (method: string, path: string, headers: Record<string, string>) => new NextRequest(`https://shopbagati.com${path}`, { method, headers: { host: "shopbagati.com", ...headers } });
    const blocked = middleware(make("POST", "/api/orders", { origin: "https://evil.example" }));
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).code, "CROSS_SITE_REQUEST");
    assert.equal(middleware(make("PUT", "/api/admin/site-settings", { origin: "https://evil.example" })).status, 403);
    assert.equal(middleware(make("PATCH", "/api/account/profile", { origin: "https://evil.example" })).status, 403);
    assert.equal(middleware(make("DELETE", "/api/admin/promotions", { origin: "https://evil.example" })).status, 403);
    assert.equal(middleware(make("POST", "/api/vendor/stores", { origin: "https://shopbagati.com" })).status, 200);
    assert.equal(middleware(make("GET", "/api/cart", { origin: "https://evil.example" })).status, 200);
    assert.equal(middleware(make("POST", "/api/security/ingest/apache", { origin: "https://evil.example" })).status, 200);
    assert.equal(middleware(make("POST", "/api/health", { origin: "https://evil.example" })).status, 200);
    assert.equal(middleware(make("POST", "/api/payments/epoint/callback", { origin: "https://evil.example" })).status, 200);
    assert.equal(middleware(make("POST", "/api/payments/epoint/initiate", { origin: "https://evil.example" })).status, 403);
    assert.equal(middleware(make("POST", "/checkout", { origin: "https://evil.example" })).status, 200);
    const canonical = middleware(new NextRequest("http://www.shopbagati.com/api/cart", { headers: { host: "www.shopbagati.com" } }));
    assert.equal(canonical.status, 308);
  } finally {
    Object.assign(process.env, { NODE_ENV: previous.nodeEnv });
    if (previous.appBaseUrl === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = previous.appBaseUrl;
  }
});
