import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commissionPercentToRate, commissionRateInput, commissionRateToPercent, hasCommissionRuleConflict } from "../lib/commission-rules";
import { adminSectionSource } from "./admin-section-source";

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

test("commission percent conversion: integer arithmetic, two decimals, bounded", () => {
  assert.equal(commissionPercentToRate("10"), "0.1000");
  assert.equal(commissionPercentToRate(10), "0.1000");
  assert.equal(commissionPercentToRate(12.5), "0.1250");
  assert.equal(commissionPercentToRate("7,25"), "0.0725");
  assert.equal(commissionPercentToRate("100"), "1.0000");
  assert.equal(commissionPercentToRate("0"), "0.0000");
  for (const bad of ["100.01", "101", "-1", "10.123", "abc", "", "1e1", null, undefined, Number.NaN, Infinity]) assert.equal(commissionPercentToRate(bad), null, String(bad));
  assert.equal(commissionPercentToRate("31", 30), null, "a lower maximum (the default commission) is respected");
  assert.equal(commissionRateToPercent("0.1000"), "10");
  assert.equal(commissionRateToPercent("0.1250"), "12.5");
  assert.equal(commissionRateToPercent(0.05), "5");
  assert.equal(commissionRateToPercent("1.0000"), "100");
  assert.equal(commissionRateToPercent({ toString: () => "0.0725" }), "7.25", "Prisma Decimal");
});

test("commission API input: ratePercent from the form, the older rate (0–1) still accepted, never both", () => {
  assert.deepEqual(commissionRateInput({ ratePercent: 10 }), { ok: true, rate: "0.1000" });
  assert.deepEqual(commissionRateInput({ ratePercent: "12.5" }), { ok: true, rate: "0.1250" });
  assert.deepEqual(commissionRateInput({ rate: 0.1 }), { ok: true, rate: 0.1 }, "backward compatible");
  assert.deepEqual(commissionRateInput({ rate: "0.2" }), { ok: true, rate: 0.2 });
  assert.deepEqual(commissionRateInput({}), { ok: true, rate: undefined }, "updates may leave the rate unchanged");
  for (const bad of [{ ratePercent: 10, rate: 0.1 }, { ratePercent: 101 }, { ratePercent: "abc" }, { rate: 1.5 }, { rate: -0.1 }]) assert.deepEqual(commissionRateInput(bad), { ok: false }, JSON.stringify(bad));
  const route = readFileSync(resolve(root, "app/api/admin/[...resource]/route.ts"), "utf8");
  assert.equal((route.match(/const rateInput = commissionRateInput\(body\);/g) ?? []).length, 2, "create and update");
  assert.match(route, /rate: rateInput\.rate, startsAt/);
  assert.match(route, /\.\.\.\(rateInput\.rate === undefined \? \{\} : \{ rate: rateInput\.rate \}\)/);
});

test("/admin/commissions: percent fields and a read-only default commission card linking to the Maliyyə tab", () => {
  const page = adminSectionSource();
  // The section is a catch-all branch or its own module in app/admin/_sections (moved one at a time).
  const moved = resolve(root, "app/admin/_sections/commissions.tsx");
  const branch = existsSync(moved) ? readFileSync(moved, "utf8") : page.slice(page.indexOf(' if(route==="commissions"){'), page.indexOf("<Pager path=\"/admin/commissions\""));
  assert.match(branch, /\{ name: "ratePercent", label: "Komissiya faizi \(%\)", type: "number", min: "0", max: "100", step: "0\.01"/);
  assert.match(branch, /\{ name: "ratePercent", label: "Faiz \(%\)", type: "number", value: commissionRateToPercent\(row\.rate\)/);
  assert.doesNotMatch(branch, /\(0–1\)/);
  assert.match(branch, /loadSettingSummary\(prisma, SETTING_KEYS\.commissionDefaultRate\)/);
  assert.match(branch, /Standart komissiya: \{defaultCommission\.display\}/);
  assert.match(branch, /href="\/admin\/settings\?tab=finance"/);
});
