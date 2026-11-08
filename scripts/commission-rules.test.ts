import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hasCommissionRuleConflict } from "../lib/commission-rules";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("commission intervals reject intersections but allow touching boundaries", () => {
  const candidate = { startsAt: new Date("2026-01-10T00:00:00Z"), endsAt: new Date("2026-02-01T00:00:00Z") };
  assert.equal(hasCommissionRuleConflict(candidate, [{ startsAt: new Date("2026-01-31T00:00:00Z"), endsAt: null }]), true);
  assert.equal(hasCommissionRuleConflict(candidate, [{ startsAt: new Date("2025-01-01T00:00:00Z"), endsAt: candidate.startsAt }]), false);
  assert.equal(hasCommissionRuleConflict({ ...candidate, endsAt: null }, [{ startsAt: new Date("2026-02-01T00:00:00Z"), endsAt: null }]), true);
});

test("commission create and update enforce interval checks inside serializable transactions", () => {
  const route = readFileSync(resolve(root, "app/api/admin/[...resource]/route.ts"), "utf8");
  assert.match(route, /hasCommissionRuleConflict/);
  assert.equal((route.match(/isolationLevel: "Serializable"/g) ?? []).length >= 2, true);
  assert.match(route, /COMMISSION_CREATE/);
  assert.match(route, /COMMISSION_UPDATE/);
});
