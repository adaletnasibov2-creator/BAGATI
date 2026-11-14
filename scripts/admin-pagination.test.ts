import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { adminSectionSource } from "./admin-section-source";
import {
  ADMIN_MAX_PAGE,
  normalizeAdminEnumFilter,
  normalizeAdminPage,
  normalizeAdminSearch,
  normalizeAdminSearchParams,
} from "../lib/admin-pagination";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const adminPage = adminSectionSource();
const adminShell = readFileSync(resolve(root, "components/admin-shell.tsx"), "utf8");
const returnRoute = readFileSync(resolve(root, "app/api/admin/returns/route.ts"), "utf8");
const adminResourceRoute = readFileSync(resolve(root, "app/api/admin/[...resource]/route.ts"), "utf8");

test("admin pagination accepts positive integer pages and bounds deep offsets", () => {
  assert.equal(normalizeAdminPage("1"), 1);
  assert.equal(normalizeAdminPage("25"), 25);
  assert.equal(normalizeAdminPage(String(ADMIN_MAX_PAGE + 1)), ADMIN_MAX_PAGE);
});

test("admin section listings use bounded pagination", () => {
  assert.match(adminPage, /normalizeAdminPage\(sp\.page\)/);
  assert.match(adminPage, /normalizeAdminSearchParams\(rawSearchParams\)/);
  assert.match(adminPage, /normalizeAdminEnumFilter\(sp\.status,productStatuses\)/);
  assert.match(returnRoute, /normalizeAdminPage\(pageParameters\.length === 1 \? pageParameters\[0\] : undefined\)/);
});

test("admin pagination safely falls back for malformed and unsafe page values", () => {
  for (const value of [undefined, null, "", "0", "-1", "1.5", "1e9", "Infinity", "9007199254740992", ["2"]]) {
    assert.equal(normalizeAdminPage(value), 1, `value ${String(value)} should fall back to the first page`);
  }
});

test("admin search parameters reject repeated values and bound search terms", () => {
  const params = normalizeAdminSearchParams({ q: ["one", "two"], status: "ACTIVE", page: undefined });
  assert.equal(params.q, undefined);
  assert.equal(params.status, "ACTIVE");
  assert.equal(normalizeAdminSearch(["repeated"]), "");
  assert.equal(normalizeAdminSearch("x".repeat(201)), "");
  assert.equal(normalizeAdminSearch("  store  "), "store");
});

test("admin enum filters ignore unsupported values before ORM queries", () => {
  assert.equal(normalizeAdminEnumFilter("ACTIVE", ["DRAFT", "ACTIVE"] as const), "ACTIVE");
  assert.equal(normalizeAdminEnumFilter("UNKNOWN", ["DRAFT", "ACTIVE"] as const), undefined);
  assert.equal(normalizeAdminEnumFilter(["ACTIVE"], ["DRAFT", "ACTIVE"] as const), undefined);
});

test("admin mutations distinguish conflicts from service failures and preserve audit atomicity", () => {
  assert.match(adminResourceRoute, /error\.code === "P2002"[\s\S]*status: 409/);
  assert.match(adminResourceRoute, /logSecurityOperationFailure\(operation, error\)/);
  for (const resource of ["category", "brand", "city"]) {
    assert.match(adminResourceRoute, new RegExp(`db\\.\\$transaction\\(async \\(tx: any\\) => \\{ const created = await tx\\.${resource}\\.create`));
  }
  assert.match(adminResourceRoute, /tx\.review\.deleteMany[\s\S]*tx\.auditLog\.create/);
  assert.match(returnRoute, /error\.message === "CONFLICT"[\s\S]*status: 409/);
  assert.match(returnRoute, /logSecurityOperationFailure\("admin_return_decision", error\)/);
});

test("mobile admin navigation exposes dialog semantics and traps keyboard focus", () => {
  assert.match(adminShell, /aria-modal="true"/);
  assert.match(adminShell, /event\.key === "Escape"/);
  assert.match(adminShell, /event\.key !== "Tab"/);
  assert.match(adminShell, /last\.focus\(\)/);
  assert.match(adminShell, /first\.focus\(\)/);
});
