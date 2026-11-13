import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { SELLER_APPLY_LOGIN_PATH, vendorAreaRedirectPath, vendorLoginCustomerBody, wrongPortalBody } from "../lib/login-portal";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
function pages(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(root, path)).isDirectory() ? pages(path) : name === "page.tsx" ? [relative(".", path).replace(/\\/g, "/")] : [];
  });
}

test("a signed-in CUSTOMER who opens the seller area goes to /vendor/apply; others go to the seller login", () => {
  assert.equal(vendorAreaRedirectPath("CUSTOMER"), "/vendor/apply");
  assert.equal(vendorAreaRedirectPath("ADMIN"), "/vendor/login");
  assert.equal(vendorAreaRedirectPath(null), "/vendor/login");
  assert.equal(vendorAreaRedirectPath(undefined), "/vendor/login");
  for (const page of ["app/vendor/page.tsx", "app/vendor/security/page.tsx", "app/vendor/stores/new/page.tsx", "app/vendor/subscription/page.tsx"]) {
    const source = read(page);
    assert.match(source, /if \(!user \|\| user\.role !== "VENDOR"\) redirect\(vendorAreaRedirectPath\(user\?\.role\)\);/, page);
    assert.doesNotMatch(source, /redirect\("\/vendor\/login"\)/, page);
  }
});

test("every store-scoped seller page uses requireVendorStorePage (owner continues, CUSTOMER to /vendor/apply, others 404)", () => {
  const storePages = pages("app/vendor/[storeId]");
  assert.ok(storePages.length >= 6);
  for (const page of storePages) {
    const source = read(page);
    assert.match(source, /requireVendorStorePage\(storeId\)/, page);
    assert.doesNotMatch(source, /requireStoreAccess\(/, page);
  }
  const helper = read("lib/vendor-area.ts");
  const body = helper.slice(helper.indexOf("export async function requireVendorStorePage"));
  const order = ["requireStoreAccess(storeId)", "if (access) return access;", 'if (user?.role === "CUSTOMER") redirect("/vendor/apply");', "notFound();"].map((needle) => {
    const index = body.indexOf(needle);
    assert.ok(index >= 0, needle);
    return index;
  });
  assert.deepEqual([...order].sort((a, b) => a - b), order, "ownership is checked first; only then the CUSTOMER redirect");
  assert.match(read("app/vendor/[...section]/page.tsx"), /redirect\(user\?\.role==="CUSTOMER"\?"\/vendor\/apply":"\/account"\)/);
});

test("seller login with a CUSTOMER account points to the seller application, after the password matched", () => {
  const body = vendorLoginCustomerBody();
  assert.equal(body.code, "WRONG_PORTAL");
  assert.equal(body.portal, "customer");
  assert.equal(body.applyPath, SELLER_APPLY_LOGIN_PATH);
  assert.equal(SELLER_APPLY_LOGIN_PATH, "/login?next=%2Fvendor%2Fapply");
  assert.match(body.error, /müştəri hesabıdır/);
  assert.match(body.error, /Satıcı müraciəti/);
  // The other portals keep their message; the customer login portal still uses the generic one.
  assert.deepEqual(wrongPortalBody("CUSTOMER"), { error: "Bu hesab müştəri girişindən açılır.", code: "WRONG_PORTAL", portal: "customer" });

  const route = read("app/api/auth/vendor-login/route.ts");
  const passwordCheck = route.indexOf("bcrypt.compare(parsed.data.password, user.passwordHash)");
  const customerMessage = route.indexOf('user.role === "CUSTOMER" ? vendorLoginCustomerBody() : wrongPortalBody(user.role)');
  assert.ok(passwordCheck > 0 && customerMessage > passwordCheck, "the customer message is shown only after the password matched");

  const form = read("components/vendor-login-form.tsx");
  assert.match(form, /setApplyHint\(data\.code === "WRONG_PORTAL" && data\.applyPath === SELLER_APPLY_LOGIN_PATH\)/);
  assert.match(form, /<Link href=\{SELLER_APPLY_LOGIN_PATH\}[^>]*>Satıcı müraciətinə keç<\/Link>/);
});
