import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { safeOAuthNextPath } from "../lib/google-oauth";
import { loginPortalForRole } from "../lib/login-portal";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
function routeFiles(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(root, path)).isDirectory() ? routeFiles(path) : name === "route.ts" ? [path] : [];
  });
}

test("public registration assigns a fixed role and never reads a role from the request", () => {
  const customer = read("app/api/auth/register/route.ts");
  const vendor = read("app/api/auth/vendor-register/route.ts");
  assert.match(customer, /role: "CUSTOMER"/);
  // Seller self-registration is closed: the route answers 410 and creates nothing.
  assert.match(vendor, /status: 410/);
  assert.doesNotMatch(vendor, /prisma|\.create\(|role: "VENDOR"/);
  for (const source of [customer, vendor]) {
    assert.doesNotMatch(source, /role: "ADMIN"/);
    assert.doesNotMatch(source, /(parsed\.data|body|data)\.role/);
  }
});

test("Google sign-in can only target customer or seller accounts, never admin", () => {
  const callback = read("app/api/auth/google/callback/route.ts");
  assert.match(callback, /role: "CUSTOMER",/);
  assert.doesNotMatch(callback, /role: "VENDOR"|vendorProfile/);
  assert.doesNotMatch(callback, /"ADMIN"/);
  assert.match(callback, /account\.role !== state\.intent\.toUpperCase\(\)/);
});

test("every admin API except login requires the ADMIN role on the server", () => {
  const normalized = (path: string) => path.replace(/\\/g, "/");
  // Pre-session steps are authorized by an ADMIN-only challenge issued after a correct password, not by a session.
  const loginCodeStep = (path: string) => normalized(path).endsWith("admin/login/2fa/route.ts");
  const enrollment = (path: string) => /admin\/2fa\/(setup|activate)\/route\.ts$/.test(normalized(path));
  const routes = routeFiles("app/api/admin").filter((path) => !normalized(path).endsWith("admin/login/route.ts"));
  assert.ok(routes.length > 5);
  for (const path of routes) {
    if (loginCodeStep(path)) assert.match(read(path), /const admin = await readChallenge\(request, "code"\);\s*if \(!admin\) return/, path);
    else if (enrollment(path)) assert.match(read(path), /const actor = await resolveEnrollmentActor\(request\);[^\n]*\n\s*if \(!actor\) return/, path);
    else assert.match(read(path), /requireRole\("ADMIN"\)/, path);
  }
  // The helpers themselves only accept a signed-in ADMIN or a challenge whose user is still an active ADMIN.
  const twoFactor = read("lib/admin-2fa.ts");
  assert.match(twoFactor, /export async function resolveEnrollmentActor[\s\S]*?await requireRole\("ADMIN"\)/);
  assert.match(twoFactor, /user\.role !== "ADMIN" \|\| !user\.isActive/);
});

test("seller APIs resolve store ownership for the signed-in seller", () => {
  const routes = routeFiles("app/api/vendor").filter((path) => path.replace(/\\/g, "/").includes("[storeId]"));
  assert.ok(routes.length > 5);
  for (const path of routes) assert.match(read(path), /requireStoreAccess\(|authorizeStore|scope\(storeId\)/, path);
  assert.match(read("lib/auth.ts"), /user\.role !== "VENDOR"\) return null; const owned = await prisma\.store\.findFirst\(\{ where: \{ id: storeId, vendor: \{ userId: user\.id \} \}/);
});

test("post-login destinations cannot leave the site or cross into another role's area", () => {
  for (const hostile of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/%0a/evil"]) {
    const destination = safeOAuthNextPath(hostile, "customer");
    assert.equal(new URL(destination, "https://shopbagati.com").origin, "https://shopbagati.com", `${hostile} → ${destination}`);
    assert.doesNotMatch(destination, /^\/\/|^https?:|\\/);
  }
  assert.equal(safeOAuthNextPath("/admin", "customer"), "/account");
  assert.equal(safeOAuthNextPath("/vendor/abc/orders", "customer"), "/account");
  assert.equal(safeOAuthNextPath("/vendor/apply", "customer"), "/vendor/apply");
  assert.equal(safeOAuthNextPath("/account/orders", "vendor"), "/vendor");
  assert.equal(safeOAuthNextPath("/checkout?step=2", "customer"), "/checkout?step=2");
});

test("each role is sent to its own login portal and dashboard", () => {
  assert.equal(loginPortalForRole("ADMIN"), "admin");
  assert.equal(loginPortalForRole("VENDOR"), "vendor");
  assert.equal(loginPortalForRole("CUSTOMER"), "customer");
  const bottomNav = read("components/mobile-bottom-nav.tsx");
  assert.match(bottomNav, /user\?\.role === "VENDOR" \? "\/vendor" : user\?\.role === "ADMIN" \? "\/admin" : user \? "\/account" : "\/login"/);
  assert.match(read("components/vendor-login-form.tsx"), /finishAuthNavigation\("\/vendor"\)/);
});

test("a signed-out phone user can reach the seller login from the mobile menu", () => {
  assert.match(read("components/mobile-menu.tsx"), /href="\/vendor\/login"[^>]*>Satıcı girişi</);
});

test("sample-data preview pages are not served in production", () => {
  assert.match(read("app/storefront-preview/page.tsx"), /NODE_ENV === "production" && process\.env\.BAGATI_ENABLE_PREVIEW_ROUTES !== "true"\) notFound\(\)/);
});
