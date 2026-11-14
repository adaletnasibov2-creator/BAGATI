/**
 * lib/format-money.ts: admin money format "1 234,50 AZN". No database.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { formatAmount, formatMoney, formatMoneyCents } from "../lib/format-money";

test("money: comma decimals, no-break space thousands, AZN suffix", () => {
  const NB = " ";
  assert.equal(formatMoney(12.5), `12,50${NB}AZN`);
  assert.equal(formatMoney(0), `0,00${NB}AZN`);
  assert.equal(formatMoney(1234.5), `1${NB}234,50${NB}AZN`);
  assert.equal(formatMoney(1234567.891), `1${NB}234${NB}567,89${NB}AZN`);
  assert.equal(formatMoney("30.00"), `30,00${NB}AZN`, "numeric strings (and Prisma Decimal via toString)");
  assert.equal(formatMoney({ toString: () => "9.99" }), `9,99${NB}AZN`);
  assert.equal(formatMoney(-5), `-5,00${NB}AZN`);
  assert.equal(formatMoney(-0.001), `0,00${NB}AZN`, "no -0,00");
  assert.equal(formatMoney(null), "—");
  assert.equal(formatMoney(undefined, "Yoxdur"), "Yoxdur");
  assert.equal(formatMoney("abc"), "—");
  assert.equal(formatAmount(999.999), `1${NB}000,00`, "rounds to 2 decimals before grouping");
  assert.equal(formatAmount(1000), `1${NB}000,00`);
  assert.equal(formatMoneyCents(123456), `1${NB}234,56${NB}AZN`);
  assert.equal(formatMoneyCents(null), "—");
});

test("admin code formats money only through lib/format-money (no ₼ literal, no hand-made \"x AZN\")", () => {
  const root = join(__dirname, "..");
  const files = [
    ...readdirSync(join(root, "app/admin"), { recursive: true }).map(String).filter((name) => name.endsWith(".tsx")).map((name) => join(root, "app/admin", name)),
    ...readdirSync(join(root, "components")).filter((name) => /^admin-.*\.tsx$/.test(name)).map((name) => join(root, "components", name)),
  ];
  assert.ok(files.length > 40);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /₼/, file);
    assert.doesNotMatch(source, /toFixed\(2\)\}? ?AZN/, `${file}: amount formatted by hand`);
  }
});
