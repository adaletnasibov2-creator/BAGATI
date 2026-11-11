import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { googleOAuthConfig, googleOAuthConfigIssues } from "../lib/google-oauth";
import { GET as startGoogleOAuth } from "../app/api/auth/google/start/route";
import { citySlug, INITIAL_CATEGORIES, INITIAL_CITY_NAMES, INITIAL_SUBSCRIPTION_PLANS, planReferenceData } from "../lib/reference-data";
import { readinessResponse, referenceDataState } from "../lib/readiness";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const setEnv = (values: Record<string, string | undefined>) => {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else Object.assign(process.env, { [key]: value });
  }
};
const configured = {
  SESSION_SECRET: "production-parity-test-session-secret-0123456789",
  GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-only-secret",
  APP_BASE_URL: "https://shopbagati.com",
};

// ---------- Google OAuth callback URL ----------

test("the callback route that Google must be configured with exists at /api/auth/google/callback", () => {
  assert.ok(existsSync(join(process.cwd(), "app/api/auth/google/callback/route.ts")));
});

test("local development on port 3001 uses the local callback", () => {
  setEnv({ ...configured, NODE_ENV: "development" });
  assert.equal(googleOAuthConfig("http://localhost:3001/api/auth/google/start", "localhost:3001").redirectUri, "http://localhost:3001/api/auth/google/callback");
});

test("production never produces a localhost callback, even if the request reaches the app as localhost", () => {
  setEnv({ ...configured, NODE_ENV: "production" });
  for (const [url, host] of [["http://localhost:3001/api/auth/google/start", "localhost:3001"], ["http://127.0.0.1:3000/x", null], ["https://shopbagati.com/x", "shopbagati.com"]] as const) {
    assert.equal(googleOAuthConfig(url, host).redirectUri, "https://shopbagati.com/api/auth/google/callback");
  }
  setEnv({ NODE_ENV: "development" });
});

test("configuration issues are named precisely without exposing any value", () => {
  assert.deepEqual(googleOAuthConfigIssues({ NODE_ENV: "production" }), ["GOOGLE_CLIENT_ID_MISSING", "GOOGLE_CLIENT_SECRET_MISSING", "SESSION_SECRET_MISSING_OR_SHORT", "APP_BASE_URL_MISSING"]);
  assert.deepEqual(googleOAuthConfigIssues({ ...configured, NODE_ENV: "production" }), []);
  assert.deepEqual(googleOAuthConfigIssues({ ...configured, NODE_ENV: "production", APP_BASE_URL: "http://shopbagati.com" }), ["APP_BASE_URL_NOT_HTTPS"]);
  assert.deepEqual(googleOAuthConfigIssues({ ...configured, NODE_ENV: "production", APP_BASE_URL: "https://www.shopbagati.com" }), ["APP_BASE_URL_NOT_CANONICAL"]);
  assert.deepEqual(googleOAuthConfigIssues({ ...configured, NODE_ENV: "production", APP_BASE_URL: "http://localhost:3001" }), ["APP_BASE_URL_NOT_HTTPS", "APP_BASE_URL_NOT_CANONICAL"]);
  assert.deepEqual(googleOAuthConfigIssues({ ...configured, NODE_ENV: "production", APP_BASE_URL: "https://shopbagati.com/app" }), ["APP_BASE_URL_NOT_CANONICAL"]);
  assert.deepEqual(googleOAuthConfigIssues({ ...configured, NODE_ENV: "development", APP_BASE_URL: undefined }), [], "local development does not need APP_BASE_URL");
  for (const issue of googleOAuthConfigIssues({ GOOGLE_CLIENT_ID: "abc", NODE_ENV: "production", APP_BASE_URL: "https://evil.example" })) {
    assert.doesNotMatch(issue, /abc|evil/);
  }
});

test("an unconfigured production server redirects to 'unavailable' and logs only the missing setting names", async () => {
  setEnv({ ...configured, NODE_ENV: "production", GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined });
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    const response = await startGoogleOAuth(new NextRequest("http://127.0.0.1:3000/api/auth/google/start?intent=customer&mode=login"));
    assert.equal(response.headers.get("location"), "https://shopbagati.com/login?oauth=unavailable");
  } finally {
    console.error = original;
    setEnv({ ...configured, NODE_ENV: "development" });
  }
  const text = JSON.stringify(logged);
  assert.match(text, /GOOGLE_CLIENT_ID_MISSING/);
  assert.match(text, /GOOGLE_CLIENT_SECRET_MISSING/);
  assert.doesNotMatch(text, /production-parity-test-session-secret|test-only-secret/);
});

// ---------- Reference data (cities, categories, plans) ----------

test("an empty database gets the launch city, all initial cities, categories and plans", () => {
  const plan = planReferenceData({ cities: [], categories: [], plans: [] });
  assert.equal(plan.cityInserts.length, INITIAL_CITY_NAMES.length + 1);
  assert.deepEqual(plan.cityInserts[0], { name: "Qazax", slug: "qazax" });
  assert.equal(plan.categoryInserts.length, INITIAL_CATEGORIES.length);
  assert.equal(plan.planInserts.length, INITIAL_SUBSCRIPTION_PLANS.length);
  assert.equal(new Set(plan.cityInserts.map((c) => c.slug)).size, plan.cityInserts.length, "no duplicate slugs");
  assert.equal(citySlug("Şəki"), "seki");
  assert.equal(citySlug("Gəncə"), "gence");
});

test("existing rows are never duplicated, reactivated or overwritten", () => {
  const plan = planReferenceData({
    cities: [{ name: "Qazax", slug: "qazax", isActive: false }, { name: "Bakı", slug: "baku", isActive: true }],
    categories: [{ name: "Elektronika", slug: "electronics", isActive: true }, { name: "Geyim", slug: "geyim", isActive: false }],
    plans: [{ slug: "BASIC", isActive: true }],
  });
  assert.ok(!plan.cityInserts.some((c) => c.slug === "qazax"), "inactive Qazax is not re-inserted");
  assert.ok(!plan.cityInserts.some((c) => c.name === "Bakı"), "same name with another slug is not duplicated");
  assert.ok(!plan.categoryInserts.some((c) => c.name === "Elektronika" || c.slug === "geyim"));
  assert.deepEqual(plan.planInserts.map((p) => p.slug), ["professional"], "existing plan (any case) keeps its admin-set price");
  assert.deepEqual(plan.inactiveExisting, [{ kind: "city", slug: "qazax" }, { kind: "category", slug: "geyim" }]);
});

test("the plan is idempotent: applying it leaves nothing to insert", () => {
  const first = planReferenceData({ cities: [], categories: [], plans: [] });
  const second = planReferenceData({
    cities: first.cityInserts.map((c) => ({ ...c, isActive: true })),
    categories: first.categoryInserts.map((c) => ({ ...c, isActive: true })),
    plans: first.planInserts.map((p) => ({ slug: p.slug, isActive: true })),
  });
  assert.deepEqual([second.cityInserts.length, second.categoryInserts.length, second.planInserts.length], [0, 0, 0]);
});

test("the insert-only tool only creates rows and defaults to a dry run; seed shares the same lists", () => {
  const tool = read("scripts/reference-data.ts");
  assert.match(tool, /process\.argv\.includes\("--apply"\)/);
  assert.match(tool, /if \(!apply\)/);
  assert.match(tool, /skipDuplicates: true/);
  assert.doesNotMatch(tool, /\.(update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|DATABASE_URL/);
  const seed = read("prisma/seed.ts");
  assert.match(seed, /from "\.\.\/lib\/reference-data"/);
  assert.match(seed, /const initialCities = INITIAL_CITY_NAMES/);
  assert.match(seed, /const initialCategories = INITIAL_CATEGORIES/);
});

// ---------- Readiness signals ----------

test("readiness reports missing reference data and Google configuration without changing its status", async () => {
  assert.equal(referenceDataState({ activeCities: 0, activeCategories: 10 }), "missing");
  assert.equal(referenceDataState({ activeCities: 3, activeCategories: 0 }), "missing");
  assert.equal(referenceDataState({ activeCities: 3, activeCategories: 10 }), "present");
  const response = await readinessResponse(async () => 1, "unconfigured", async () => ({ googleSignIn: "unconfigured", referenceData: "missing" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ready", storage: "unconfigured", googleSignIn: "unconfigured", referenceData: "missing" });
  const failingDetails = await readinessResponse(async () => 1, "local", async () => { throw new Error("db password=secret"); });
  assert.deepEqual(await failingDetails.json(), { status: "ready", storage: "local" });
  assert.match(read("app/api/ready/route.ts"), /googleOAuthConfigIssues\(\)\.length \? "unconfigured" : "configured"/);
});

// ---------- Category and contact rendering sources ----------

test("category menu shows an honest empty state instead of a link to an empty page", () => {
  const menu = read("components/category-mega-menu.tsx");
  assert.match(menu, /Kateqoriyalar hələ əlavə edilməyib\./);
  assert.match(read("app/(customer)/layout.tsx"), /prisma\.category\.findMany\(\{\s*where: \{ isActive: true, parentId: null \}/);
});

test("footer contact details come only from the SiteSettings row, never from hardcoded values", () => {
  const footer = read("components/customer-footer.tsx");
  assert.match(footer, /settings\.contactPhone/);
  assert.match(footer, /settings\.contactEmail/);
  assert.doesNotMatch(footer, /\+994\d|@shopbagati\.com/);
  assert.match(read("lib/site-settings.ts"), /prisma\.siteSettings\.findUnique/);
});
