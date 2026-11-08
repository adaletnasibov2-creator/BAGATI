import assert from "node:assert/strict";

if (!process.env.BAGATI_BASE_URL) {
  throw new Error("Set BAGATI_BASE_URL to the BAGATI server under test; no default server is assumed.");
}

const base = new URL(process.env.BAGATI_BASE_URL);
if (!new Set(["localhost", "127.0.0.1", "::1"]).has(base.hostname)) {
  throw new Error("Security smoke checks may only target a local BAGATI server.");
}
if (base.username || base.password || base.search || base.hash) {
  throw new Error("BAGATI_BASE_URL must not contain credentials, a query, or a fragment.");
}

const home = await fetch(base, { redirect: "manual", signal: AbortSignal.timeout(5_000) });
if (home.status !== 200 || home.headers.get("x-bagati-application") !== "bagati-marketplace") {
  throw new Error(`Refusing security checks: ${base.origin} is unavailable or did not identify itself as BAGATI (HTTP ${home.status}). Build/start this workspace first.`);
}

const checks = [
  ["customer cart requires authentication", "/api/cart", 401],
  ["customer order history requires authentication", "/api/orders", 401],
  ["account profile requires authentication", "/api/account/profile", 401],
  ["password change requires authentication", "/api/account/security/password", 401, "PATCH"],
  ["vendor store creation requires vendor authentication", "/api/vendor/stores", 403, "POST"],
  ["admin store management requires admin authentication", "/api/admin/stores", 403, "POST"],
  ["invalid product pagination is rejected", "/api/products?page=0", 400],
];

for (const [label, path, expected, method = "GET"] of checks) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: method === "PATCH" || method === "POST" ? { "content-type": "application/json", origin: base.origin } : undefined,
    body: method === "PATCH" || method === "POST" ? "{}" : undefined,
    redirect: "manual",
  });
  assert.equal(response.status, expected, `${label}: expected ${expected}, got ${response.status}`);
  const body = await response.text();
  assert.doesNotMatch(body, /passwordHash|SESSION_SECRET|DATABASE_URL/i, `${label}: sensitive data leaked`);
  console.log(`PASS ${label}`);
}

const vendorCookie = process.env.BAGATI_VENDOR_A_COOKIE;
const ownStoreId = process.env.BAGATI_VENDOR_A_STORE_ID;
const otherStoreId = process.env.BAGATI_VENDOR_B_STORE_ID;
if (vendorCookie && ownStoreId && otherStoreId) {
  for (const [label, suffix, method] of [
    ["cross-vendor order access is denied", "orders", "GET"],
    ["cross-vendor product access is denied", "products", "GET"],
    ["cross-vendor campaign access is denied", "campaigns", "GET"],
    ["cross-vendor import history access is denied", "imports", "GET"],
    ["cross-vendor inventory access is denied", "inventory", "GET"],
    ["cross-vendor sales access is denied", "sales", "GET"],
    ["cross-vendor profile access is denied", "profile", "GET"],
    ["cross-vendor review access is denied", "reviews", "GET"],
    ["cross-vendor notification access is denied", "notifications", "GET"],
    ["cross-vendor subscription access is denied", "subscription", "GET"],
    ["cross-vendor asset upload is denied", "assets", "POST"],
  ]) {
    const response = await fetch(new URL(`/api/vendor/${encodeURIComponent(otherStoreId)}/${suffix}`, base), {
      method, headers: { cookie: vendorCookie }, body: method === "POST" ? new FormData() : undefined, redirect: "manual",
    });
    assert.equal(response.status, 403, `${label}: expected 403, got ${response.status}`);
    console.log(`PASS ${label}`);
  }
  const crossVendorLocation = await fetch(new URL(`/api/vendor/${encodeURIComponent(otherStoreId)}/profile`, base), {
    method: "PATCH",
    headers: { cookie: vendorCookie, "content-type": "application/json", origin: base.origin },
    body: JSON.stringify({ latitude: 40.4, longitude: 49.8, address: "Ownership probe" }),
    redirect: "manual",
  });
  assert.equal(crossVendorLocation.status, 403, `cross-vendor store location update should be denied, got ${crossVendorLocation.status}`);
  console.log("PASS cross-vendor store location update is denied");
  const ownUpload = new FormData(); ownUpload.append("file", new Blob(["not an image"]), "probe.png");
  const uploadResponse = await fetch(new URL(`/api/vendor/${encodeURIComponent(ownStoreId)}/assets`, base), { method: "POST", headers: { cookie: vendorCookie }, body: ownUpload, redirect: "manual" });
  assert.equal(uploadResponse.status, 415, `invalid image upload should be rejected with 415, got ${uploadResponse.status}`);
  console.log("PASS invalid image bytes are rejected");
} else {
  console.log("SKIP authenticated vendor IDOR and upload checks (set BAGATI_VENDOR_A_COOKIE, BAGATI_VENDOR_A_STORE_ID and BAGATI_VENDOR_B_STORE_ID for a two-vendor fixture)");
}

if (process.env.BAGATI_CUSTOMER_A_COOKIE && process.env.BAGATI_CUSTOMER_B_ORDER_ID) {
  const response = await fetch(new URL(`/orders/${encodeURIComponent(process.env.BAGATI_CUSTOMER_B_ORDER_ID)}`, base), { headers: { cookie: process.env.BAGATI_CUSTOMER_A_COOKIE }, redirect: "manual" });
  assert.equal(response.status, 404, `another customer's order page should be concealed, got ${response.status}`);
  console.log("PASS customer order IDOR is concealed");
} else {
  console.log("SKIP authenticated customer order IDOR check (set BAGATI_CUSTOMER_A_COOKIE and BAGATI_CUSTOMER_B_ORDER_ID for a two-customer fixture)");
}

for (const [header, value] of [["x-content-type-options", "nosniff"], ["x-frame-options", "DENY"], ["referrer-policy", "strict-origin-when-cross-origin"]]) {
  assert.equal(home.headers.get(header), value, `missing ${header} security header`);
}
console.log("PASS security headers");
