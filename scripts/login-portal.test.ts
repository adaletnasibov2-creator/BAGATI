import assert from "node:assert/strict";
import { test } from "node:test";
import { isLoginPortal, loginPortalForRole, loginPortalLinkLabel, loginPortalPath, wrongPortalBody } from "../lib/login-portal";

test("a confirmed password on the wrong portal names that portal and does not look like a bad password", () => {
  assert.equal(loginPortalForRole("CUSTOMER"), "customer");
  assert.equal(loginPortalForRole("VENDOR"), "vendor");
  assert.equal(loginPortalForRole("ADMIN"), "admin");
  assert.deepEqual(wrongPortalBody("VENDOR"), { error: "Bu hesab satıcı girişindən açılır.", code: "WRONG_PORTAL", portal: "vendor" });
  assert.deepEqual(wrongPortalBody("ADMIN"), { error: "Bu hesab idarəçi girişindən açılır.", code: "WRONG_PORTAL", portal: "admin" });
  assert.deepEqual(wrongPortalBody("CUSTOMER"), { error: "Bu hesab müştəri girişindən açılır.", code: "WRONG_PORTAL", portal: "customer" });
  assert.equal(loginPortalPath("vendor"), "/vendor/login");
  assert.equal(loginPortalPath("admin"), "/admin/login");
  assert.equal(loginPortalPath("customer"), "/login");
  assert.equal(loginPortalPath("seller"), null);
  assert.equal(isLoginPortal("vendor"), true);
  assert.equal(isLoginPortal("owner"), false);
  assert.equal(loginPortalLinkLabel("vendor"), "Satıcı girişinə keç");
});
