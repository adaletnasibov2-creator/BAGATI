import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { createHash, createHmac } from "node:crypto";
import { SignJWT } from "jose";
import {
  GOOGLE_OAUTH_COOKIE,
  createGoogleOAuthState,
  exchangeGoogleCode,
  googleAuthorizationUrl,
  googleEndpoints,
  googleOAuthConfig,
  googleOAuthCookieOptions,
  safeEqual,
  safeOAuthNextPath,
  verifyGoogleOAuthState,
} from "../lib/google-oauth";
import { googleLinkDestination } from "../lib/google-link";
import { canonicalHostRedirectUrl } from "../lib/host-policy";
import { NextRequest } from "next/server";
import { GET as startGoogleOAuth } from "../app/api/auth/google/start/route";
import { GET as googleOAuthCallback } from "../app/api/auth/google/callback/route";
import { startFakeGoogle, type FakeGoogleTamper } from "./fake-google-oidc";
import { googleOAuthMessage } from "../components/google-oauth-button";

const oldEnv = {
  secret: process.env.SESSION_SECRET,
  appBaseUrl: process.env.APP_BASE_URL,
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  nodeEnv: process.env.NODE_ENV,
};

after(() => {
  for (const [key, value] of Object.entries({
    SESSION_SECRET: oldEnv.secret,
    APP_BASE_URL: oldEnv.appBaseUrl,
    GOOGLE_CLIENT_ID: oldEnv.clientId,
    GOOGLE_CLIENT_SECRET: oldEnv.clientSecret,
    NODE_ENV: oldEnv.nodeEnv,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("Google OAuth requires server-side credentials and a canonical production origin", () => {
  process.env.SESSION_SECRET = "google-oauth-test-session-secret-at-least-32-chars";
  process.env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "server-only-test-secret";
  process.env.APP_BASE_URL = "https://shopbagati.com";
  Object.assign(process.env, { NODE_ENV: "production" });
  assert.deepEqual(googleOAuthConfig(), {
    clientId: "client-id.apps.googleusercontent.com",
    clientSecret: "server-only-test-secret",
    origin: "https://shopbagati.com",
    redirectUri: "https://shopbagati.com/api/auth/google/callback",
  });
  process.env.APP_BASE_URL = "https://www.shopbagati.com";
  assert.throws(() => googleOAuthConfig(), /canonical shopbagati\.com/);
  delete process.env.GOOGLE_CLIENT_SECRET;
  assert.throws(() => googleOAuthConfig(), /credentials are not configured/);
});

test("OAuth redirects remain local and within the role-specific area", () => {
  assert.equal(safeOAuthNextPath("/checkout?from=login", "customer"), "/checkout?from=login");
  assert.equal(safeOAuthNextPath("//evil.example/path", "customer"), "/account");
  assert.equal(safeOAuthNextPath("/\\evil.example", "customer"), "/account");
  assert.equal(safeOAuthNextPath("/admin", "customer"), "/account");
  assert.equal(safeOAuthNextPath("/vendor/products", "customer"), "/account");
  assert.equal(safeOAuthNextPath("/vendor/products", "vendor"), "/vendor/products");
  assert.equal(safeOAuthNextPath("/account", "vendor"), "/vendor");
  assert.equal(safeOAuthNextPath("/vendor/apply", "customer"), "/vendor/apply");
  assert.equal(safeOAuthNextPath("/vendor/apply?from=banner", "customer"), "/vendor/apply?from=banner");
  assert.equal(safeOAuthNextPath("/vendor/apply/extra", "customer"), "/account");
  assert.equal(safeOAuthNextPath("https://evil.example/account", "customer"), "/account");
});

test("Google endpoints stay on Google unless a non-production loopback override is explicit", () => {
  const real = googleEndpoints({});
  assert.equal(real.token, "https://oauth2.googleapis.com/token");
  assert.equal(real.jwks, "https://www.googleapis.com/oauth2/v3/certs");
  assert.deepEqual(googleEndpoints({ NODE_ENV: "production", BAGATI_ALLOW_OAUTH_TEST_ENDPOINTS: "1", BAGATI_GOOGLE_OAUTH_TEST_ISSUER: "http://127.0.0.1:4545" }), real);
  assert.deepEqual(googleEndpoints({ NODE_ENV: "development", BAGATI_GOOGLE_OAUTH_TEST_ISSUER: "http://127.0.0.1:4545" }), real);
  assert.deepEqual(googleEndpoints({ NODE_ENV: "development", BAGATI_ALLOW_OAUTH_TEST_ENDPOINTS: "1", BAGATI_GOOGLE_OAUTH_TEST_ISSUER: "https://127.0.0.1:4545" }), real);
  assert.deepEqual(googleEndpoints({ NODE_ENV: "development", BAGATI_ALLOW_OAUTH_TEST_ENDPOINTS: "1", BAGATI_GOOGLE_OAUTH_TEST_ISSUER: "http://attacker.example" }), real);
  assert.deepEqual(googleEndpoints({ NODE_ENV: "development", BAGATI_ALLOW_OAUTH_TEST_ENDPOINTS: "1", BAGATI_GOOGLE_OAUTH_TEST_ISSUER: "http://127.0.0.1:4545/ignored" }), {
    authorization: "http://127.0.0.1:4545/authorize",
    token: "http://127.0.0.1:4545/token",
    jwks: "http://127.0.0.1:4545/certs",
  });
});

test("existing-account OAuth conflicts name the matched portal and never merge accounts", async () => {
  for (const intent of ["vendor", "customer"] as const) {
    assert.match(googleOAuthMessage("account-exists", intent), /Hesablar avtomatik birləşdirilmir/);
    assert.match(googleOAuthMessage("account-exists", intent), /giriş bölməsini seçin/);
  }
  assert.match(googleOAuthMessage("account-exists", "customer", "vendor"), /satıcı girişindən açılan BAGATI hesabına aiddir/);
  assert.match(googleOAuthMessage("account-exists", "vendor", "customer"), /müştəri girişindən açılan BAGATI hesabına aiddir/);
  assert.match(googleOAuthMessage("account-exists", "customer", "admin"), /admin hesabına aiddir/);
  assert.match(googleOAuthMessage("account-exists", "customer", "vendor"), /Hesablar avtomatik birləşdirilmir/);
  assert.match(googleOAuthMessage("link-pending", "customer", "vendor"), /Google kimliyini bağlamaq üçün/);
  assert.equal(googleLinkDestination("CUSTOMER", "/admin"), "/account");
  assert.equal(googleLinkDestination("CUSTOMER", "https://evil.example"), "/account");
  assert.equal(googleLinkDestination("VENDOR", "/account"), "/vendor");
  assert.equal(googleLinkDestination("VENDOR", "/vendor/stores/new"), "/vendor/stores/new");
  assert.equal(googleLinkDestination("ADMIN", "/admin"), "/login");
  assert.match(googleOAuthMessage("account-exists", "customer", "admin"), /Admin hesablarına Google bağlama dəstəklənmir/);
  assert.match(googleOAuthMessage("expired", "customer"), /vaxtı bitib/);
  assert.match(googleOAuthMessage("reused", "customer"), /artıq istifadə olunub/);
  assert.match(googleOAuthMessage("mismatch", "customer"), /uyğun deyil/);
  assert.match(googleOAuthMessage("conflict", "customer"), /başqa BAGATI hesabına bağlıdır/);
  assert.match(googleOAuthMessage("linked", "customer"), /təhlükəsiz şəkildə bağlandı/);
  assert.match(googleOAuthMessage("wrong-role", "customer", "vendor"), /satıcı girişindən açılan/);
  const button = await readFile(new URL("../components/google-oauth-button.tsx", import.meta.url), "utf8");
  assert.match(button, /errorCode === "link-pending"/);
  assert.match(button, /href="\/login"/);
  assert.match(button, /href="\/vendor\/login"/);
  assert.match(button, /href="\/admin\/login"/);
  assert.match(button, /Admin hesablarına Google bağlama dəstəklənmir/);
  const loginForm = await readFile(new URL("../components/login-form.tsx", import.meta.url), "utf8");
  assert.match(loginForm, /\/vendor\/login/);
});

test("OAuth state is signed, short-lived, bound to intent, mode, nonce, and PKCE verifier", async () => {
  process.env.SESSION_SECRET = "google-oauth-test-session-secret-at-least-32-chars";
  const state = {
    state: "opaque-state",
    nonce: "opaque-nonce",
    verifier: "pkce-verifier",
    intent: "customer" as const,
    mode: "register" as const,
    next: "/account",
  };
  const token = await createGoogleOAuthState(state);
  assert.deepEqual(await verifyGoogleOAuthState(token), state);
  assert.equal(await verifyGoogleOAuthState(`${token}x`), null);
  const derivedStateSecret = createHmac("sha256", process.env.SESSION_SECRET).update("BAGATI_GOOGLE_OAUTH_STATE_V1").digest();
  for (const alg of ["HS384", "HS512"]) {
    const forged = await new SignJWT(state).setProtectedHeader({ alg, typ: "JWT" }).setIssuer("bagati").setAudience("bagati-google-oauth").setIssuedAt().setExpirationTime("10m").sign(derivedStateSecret);
    assert.equal(await verifyGoogleOAuthState(forged), null, `${alg} state token must be rejected`);
  }
  const expired = await new SignJWT(state).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuer("bagati").setAudience("bagati-google-oauth")
    .setIssuedAt(Math.floor(Date.now() / 1000) - 600).setExpirationTime(Math.floor(Date.now() / 1000) - 300).sign(derivedStateSecret);
  assert.equal(await verifyGoogleOAuthState(expired), null, "expired state token must be rejected");
  const linkState = await createGoogleOAuthState({ ...state, mode: "link", accountUserId: "account-user-id" });
  assert.deepEqual(await verifyGoogleOAuthState(linkState), { ...state, mode: "link", accountUserId: "account-user-id" });
  const linkWithoutUser = await createGoogleOAuthState({ ...state, mode: "link" });
  assert.equal(await verifyGoogleOAuthState(linkWithoutUser), null);
  assert.equal(safeEqual("same", "same"), true);
  assert.equal(safeEqual("same", "diff"), false);
  const cookie = googleOAuthCookieOptions();
  assert.equal(GOOGLE_OAUTH_COOKIE, "bagati_google_oauth");
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "lax");
  assert.equal(cookie.path, "/api/auth/google");
  assert.equal(cookie.secure, true);
  assert.equal(cookie.maxAge, 600);
});

test("local development keeps the browser origin when APP_BASE_URL is the public site", async () => {
  process.env.SESSION_SECRET = "google-oauth-test-session-secret-at-least-32-chars";
  process.env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "server-only-test-secret";
  process.env.APP_BASE_URL = "https://shopbagati.com";
  Object.assign(process.env, { NODE_ENV: "development" });
  assert.equal(googleOAuthConfig("http://127.0.0.1:3000/api/auth/google/start").redirectUri, "http://127.0.0.1:3000/api/auth/google/callback");
  assert.equal(googleOAuthConfig("http://localhost:3000/login").redirectUri, "http://localhost:3000/api/auth/google/callback");
  assert.equal(googleOAuthConfig("http://amon:3000/login").redirectUri, "http://amon:3000/api/auth/google/callback");
  assert.equal(googleOAuthConfig("http://192.168.1.1:3000/login").redirectUri, "http://192.168.1.1:3000/api/auth/google/callback");
  assert.equal(googleOAuthConfig("http://evil.example/login").redirectUri, "https://shopbagati.com/api/auth/google/callback");
  Object.assign(process.env, { NODE_ENV: "production" });
  assert.equal(googleOAuthConfig("http://127.0.0.1:3000/login").redirectUri, "https://shopbagati.com/api/auth/google/callback");
  const started = await startGoogleOAuth(new NextRequest("http://127.0.0.1:3000/api/auth/google/start?intent=customer&mode=login&next=%2Faccount"));
  Object.assign(process.env, { NODE_ENV: "development" });
  const localStart = await startGoogleOAuth(new NextRequest("http://localhost:3000/api/auth/google/start?intent=customer&mode=login&next=%2Faccount", { headers: { host: "127.0.0.1:3000" } }));
  assert.equal(started.status, 307);
  assert.equal(new URL(started.headers.get("location") ?? "").searchParams.get("redirect_uri"), "https://shopbagati.com/api/auth/google/callback");
  assert.equal(localStart.status, 307);
  assert.equal(new URL(localStart.headers.get("location") ?? "").searchParams.get("redirect_uri"), "http://127.0.0.1:3000/api/auth/google/callback");
  const invalidLocal = await startGoogleOAuth(new NextRequest("http://localhost:3000/api/auth/google/start?intent=admin&mode=login", { headers: { host: "127.0.0.1:3000" } }));
  assert.equal(invalidLocal.headers.get("location"), "http://127.0.0.1:3000/login?oauth=invalid");
  Object.assign(process.env, { NODE_ENV: "production" });
  const invalidProduction = await startGoogleOAuth(new NextRequest("http://127.0.0.1:3000/api/auth/google/start?intent=admin&mode=login", { headers: { host: "127.0.0.1:3000" } }));
  assert.equal(invalidProduction.headers.get("location"), "https://shopbagati.com/login?oauth=invalid");
  Object.assign(process.env, { NODE_ENV: "development" });
});

test("authorization request uses Google's code flow, OIDC, nonce, and S256 PKCE", async () => {
  process.env.SESSION_SECRET = "google-oauth-test-session-secret-at-least-32-chars";
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "server-only-test-secret";
  Object.assign(process.env, { NODE_ENV: "development" });
  const { url, signedState } = await googleAuthorizationUrl({
    config: googleOAuthConfig(),
    intent: "vendor",
    mode: "register",
    next: "/vendor",
  });
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.pathname, "/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:3000/api/auth/google/callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.match(url.searchParams.get("code_challenge") ?? "", /^[A-Za-z0-9_-]{43}$/);
  assert.equal(url.searchParams.get("nonce")?.length, 43);
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  assert.equal(url.searchParams.get("prompt"), "select_account");
  const state = await verifyGoogleOAuthState(signedState);
  assert.equal(url.searchParams.get("state"), state?.state);
  assert.equal(state?.intent, "vendor");
  assert.equal(state?.mode, "register");
});

test("Google OAuth start fails closed with a safe local error redirect when credentials are missing", async () => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  Object.assign(process.env, { NODE_ENV: "development" });
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  const response = await startGoogleOAuth(new NextRequest(
    "http://localhost:3000/api/auth/google/start?intent=customer&mode=login&next=%2Faccount",
  ));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost:3000/login?oauth=unavailable");
  assert.equal(response.cookies.get("bagati_google_oauth")?.value, undefined);
});

test("www requests are permanently canonicalized to the apex host while preserving path and query", () => {
  const target = canonicalHostRedirectUrl("http://www.shopbagati.com/api/auth/google/start?intent=vendor&mode=register", "www.shopbagati.com");
  assert.equal(target?.toString(), "https://shopbagati.com/api/auth/google/start?intent=vendor&mode=register");
  assert.equal(canonicalHostRedirectUrl("http://localhost:3000/login", "localhost:3000"), null);
  assert.equal(canonicalHostRedirectUrl("https://shopbagati.com/login", "shopbagati.com"), null);
});

test("OAuth account creation and linking preserve legacy password state without inferring origin", async () => {
  const migration = await readFile(new URL("../prisma/migrations/20261015130000_google_oauth_accounts/migration.sql", import.meta.url), "utf8");
  const callback = await readFile(new URL("../app/api/auth/google/callback/route.ts", import.meta.url), "utf8");
  const start = await readFile(new URL("../app/api/auth/google/start/route.ts", import.meta.url), "utf8");
  const oauth = await readFile(new URL("../lib/google-oauth.ts", import.meta.url), "utf8");
  const recovery = await readFile(new URL("../app/api/auth/forgot-password/route.ts", import.meta.url), "utf8");
  const passwordAuthMigration = await readFile(new URL("../prisma/migrations/20261016010000_password_auth_provider/migration.sql", import.meta.url), "utf8");
  const preserveLinkedPasswordAuthMigration = await readFile(new URL("../prisma/migrations/20261016020000_preserve_linked_password_auth/migration.sql", import.meta.url), "utf8");
  const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE "GoogleAccount"/);
  assert.match(migration, /FOREIGN KEY \("userId"\) REFERENCES "User"\("id"\) ON DELETE CASCADE/);
  assert.doesNotMatch(migration, /\b(DROP|TRUNCATE)\b|DELETE\s+FROM|\bUPDATE\s+"(?:User|GoogleAccount)"/i);
  assert.match(oauth, /email_verified !== true/);
  assert.match(callback, /state\.mode === "login"/);
  assert.match(callback, /state\.intent\.toUpperCase\(\)/);
  assert.match(callback, /account-exists/);
  assert.match(callback, /existingAccountIdentity/);
  assert.match(callback, /createGoogleLinkTransaction/);
  assert.match(callback, /\/auth\/google\/link/);
  assert.doesNotMatch(callback, /resultUrl\(origin, state, "link-pending"/);
  assert.doesNotMatch(callback, /createSession\(existing/);
  assert.match(await readFile(new URL("../lib/existing-account.ts", import.meta.url), "utf8"), /take: 2/);
  assert.match(callback, /searchParams\.set\("portal", portal\)/);
  assert.doesNotMatch(callback, /googleAccount\.create\(\{ data: \{ googleSub: identity\.sub, userId: existing/);
  assert.match(callback, /state\.mode === "link"/);
  assert.match(callback, /account\.id !== state\.accountUserId/);
  assert.match(callback, /identity\.email/);
  assert.match(callback, /googleAccount\.create/);
  assert.match(start, /modeValue !== "link"/);
  assert.match(recovery, /passwordAuthEnabled/);
  assert.match(callback, /passwordAuthEnabled: false/);
  assert.match(passwordAuthMigration, /ADD COLUMN "passwordAuthEnabled" BOOLEAN NOT NULL DEFAULT true/);
  assert.doesNotMatch(passwordAuthMigration, /\b(DROP|TRUNCATE)\b|DELETE\s+FROM/i);
  assert.doesNotMatch(passwordAuthMigration, /\b(UPDATE|DELETE|INSERT)\b/i);
  assert.match(preserveLinkedPasswordAuthMigration, /Intentionally no data backfill/);
  assert.doesNotMatch(preserveLinkedPasswordAuthMigration, /\b(UPDATE|DELETE|INSERT|DROP|TRUNCATE)\b/i);
  assert.match(schema, /passwordAuthEnabled\s+Boolean\s+@default\(true\)/);
  const linkingFlow = callback.slice(callback.indexOf('if (state.mode === "link")'), callback.indexOf("let userId = await linkedUserId"));
  assert.match(linkingFlow, /googleAccount\.create/);
  assert.doesNotMatch(linkingFlow, /passwordAuthEnabled/);
  assert.match(callback, /transaction\.user\.create\([\s\S]*?passwordAuthEnabled: false/);
  assert.match(recovery, /Google ilə yaradılmış və şifrə girişi bağlı olan hesablar Google girişi ilə istifadə olunur/);
  const customerLoginPage = await readFile(new URL("../app/(customer)/login/page.tsx", import.meta.url), "utf8");
  const customerRegisterPage = await readFile(new URL("../app/(customer)/register/page.tsx", import.meta.url), "utf8");
  assert.match(customerLoginPage, /safeOAuthNextPath\(next, "customer"\)/);
  assert.match(customerRegisterPage, /safeOAuthNextPath\(next, "customer"\)/);
});

test("existing transactional email flows already enqueue order, status, security, and recovery messages", async () => {
  const files = [
    "app/api/orders/route.ts",
    "app/api/vendor/[storeId]/[section]/route.ts",
    "app/api/admin/[...resource]/route.ts",
    "app/api/auth/reset-password/route.ts",
  ];
  const contents = await Promise.all(files.map(path => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
  assert.match(contents[0], /CUSTOMER_ORDER_CONFIRMED/);
  assert.match(contents[0], /SELLER_NEW_ORDER/);
  assert.match(contents[1], /template:"ORDER_STATUS"/);
  assert.match(contents[2], /template: "ORDER_STATUS"/);
  assert.match(contents[3], /template: "ACCOUNT_SECURITY"/);
});

test("Google ID token exchange accepts RS256 from the configured provider and rejects bad tokens", async () => {
  const clientId = "phase1-oauth-test.apps.googleusercontent.com";
  const clientSecret = "phase1-oauth-test-client-secret";
  const redirectUri = "http://localhost:3000/api/auth/google/callback";
  const fake = await startFakeGoogle({ clientId, clientSecret, redirectUri });
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    allow: process.env.BAGATI_ALLOW_OAUTH_TEST_ENDPOINTS,
    issuer: process.env.BAGATI_GOOGLE_OAUTH_TEST_ISSUER,
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    appBaseUrl: process.env.APP_BASE_URL,
    secret: process.env.SESSION_SECRET,
  };
  Object.assign(process.env, { NODE_ENV: "development" });
  process.env.BAGATI_ALLOW_OAUTH_TEST_ENDPOINTS = "1";
  process.env.BAGATI_GOOGLE_OAUTH_TEST_ISSUER = fake.issuer;
  process.env.GOOGLE_CLIENT_ID = clientId;
  process.env.GOOGLE_CLIENT_SECRET = clientSecret;
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.SESSION_SECRET = "google-oauth-test-session-secret-at-least-32-chars";
  try {
    const verifier = "pkce-verifier-value-with-enough-entropy-for-the-test";
    const codeChallenge = createHash("sha256").update(verifier).digest("base64url");
    const identity = { sub: "google-sub-1", email: "Person@Example.com", givenName: "Ada", familyName: "Test" };
    const config = googleOAuthConfig();
    const accepted = await exchangeGoogleCode(fake.issueCode({ nonce: "nonce-1", codeChallenge, identity }), verifier, config);
    assert.equal(accepted.identity.email, "person@example.com");
    assert.equal(accepted.identity.givenName, "Ada");
    assert.equal(accepted.nonce, "nonce-1");
    const mismatchedState = await createGoogleOAuthState({ state: "opaque-state", nonce: "different-nonce", verifier, intent: "customer", mode: "register", next: "/account" });
    const mismatched = await googleOAuthCallback(new NextRequest(`http://localhost:3000/api/auth/google/callback?state=opaque-state&code=${fake.issueCode({ nonce: "nonce-1", codeChallenge, identity })}`, { headers: { cookie: `bagati_google_oauth=${mismatchedState}` } }));
    assert.equal(new URL(mismatched.headers.get("location") || "").searchParams.get("oauth"), "invalid");
    const forgedState = await googleOAuthCallback(new NextRequest(`http://localhost:3000/api/auth/google/callback?state=forged&code=${fake.issueCode({ nonce: "nonce-1", codeChallenge, identity })}`, { headers: { cookie: `bagati_google_oauth=${mismatchedState}` } }));
    assert.equal(new URL(forgedState.headers.get("location") || "").searchParams.get("oauth"), "invalid");
    await assert.rejects(exchangeGoogleCode(fake.issueCode({ nonce: "nonce-1", codeChallenge, identity }), "wrong-verifier", config));
    for (const tamper of ["hs256", "wrong-signature", "wrong-audience", "wrong-issuer", "unverified-email"] as FakeGoogleTamper[]) {
      await assert.rejects(exchangeGoogleCode(fake.issueCode({ nonce: "nonce-1", codeChallenge, identity, tamper }), verifier, config), new RegExp("."));
    }
  } finally {
    await fake.close();
    const restore = (key: string, value: string | undefined) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; };
    Object.assign(process.env, { NODE_ENV: previous.nodeEnv });
    restore("BAGATI_ALLOW_OAUTH_TEST_ENDPOINTS", previous.allow);
    restore("BAGATI_GOOGLE_OAUTH_TEST_ISSUER", previous.issuer);
    restore("GOOGLE_CLIENT_ID", previous.clientId);
    restore("GOOGLE_CLIENT_SECRET", previous.clientSecret);
    restore("APP_BASE_URL", previous.appBaseUrl);
    restore("SESSION_SECRET", previous.secret);
  }
});

test("OAuth callback errors stay on the local origin in development and the canonical origin in production", async () => {
  const previous = { nodeEnv: process.env.NODE_ENV, clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, appBaseUrl: process.env.APP_BASE_URL };
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  try {
    Object.assign(process.env, { NODE_ENV: "development" });
    process.env.APP_BASE_URL = "http://localhost:3000";
    const local = await googleOAuthCallback(new NextRequest("http://localhost:3000/api/auth/google/callback?state=missing"));
    assert.equal(local.status, 307);
    assert.equal(local.headers.get("location"), "http://localhost:3000/login?oauth=invalid");
    Object.assign(process.env, { NODE_ENV: "production" });
    const production = await googleOAuthCallback(new NextRequest("http://internal-proxy/api/auth/google/callback?state=missing", { headers: { host: "shopbagati.com" } }));
    assert.equal(production.headers.get("location"), "https://shopbagati.com/login?oauth=invalid");
  } finally {
    Object.assign(process.env, { NODE_ENV: previous.nodeEnv });
    const restore = (key: string, value: string | undefined) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; };
    restore("GOOGLE_CLIENT_ID", previous.clientId);
    restore("GOOGLE_CLIENT_SECRET", previous.clientSecret);
    restore("APP_BASE_URL", previous.appBaseUrl);
  }
});

test("OAuth start and callback have local backstops and only use configured trusted proxy IPs", async () => {
  const [start, callback] = await Promise.all([
    readFile(new URL("../app/api/auth/google/start/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/google/callback/route.ts", import.meta.url), "utf8"),
  ]);
  for (const route of [start, callback]) {
    assert.match(route, /consumeAuthProcessRateLimit\("google-oauth-/);
    assert.match(route, /trustedCloudflareClientIp\(request\.headers\)/);
    assert.match(route, /authRateLimitKey\("google-oauth-/);
    assert.match(route, /consumeAuthRateLimit/);
  }
});
