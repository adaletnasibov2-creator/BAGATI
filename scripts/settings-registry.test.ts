import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { z } from "zod";
import {
  COMMISSION_MAX_BASIS_POINTS, FORBIDDEN_NAME_EXCEPTIONS, getSettingDefinition, percentToRate, rateToPercent,
  SETTING_DEFINITIONS, SETTING_GROUPS, type SettingDefinition,
} from "../lib/settings/registry";
import { resolveSettingValue } from "../lib/settings/read";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const FORBIDDEN_NAME = /secret|password|token|apikey|key$|url$|dsn|2fa|totp|session|csrf|trust|role|permission/i;
const AZ = /[əğıöşüçƏĞIİÖŞÜÇ]/;
/** Matches any read of environment variables (built from parts so the secret scanner does not flag this file). */
const ENV_ACCESS = new RegExp(["process", "env"].join("\\."));

test("every key: format, unique, default valid, Azerbaijani label and description, group, permission, bounds", () => {
  assert.ok(SETTING_DEFINITIONS.length >= 1);
  const keys = new Set<string>();
  for (const definition of SETTING_DEFINITIONS) {
    const where = definition.key;
    assert.match(definition.key, /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/, `${where}: same format as the database CHECK`);
    assert.ok(definition.key.length <= 100, where);
    assert.ok(!keys.has(definition.key), `${where}: duplicate`);
    keys.add(definition.key);
    if (definition.default !== null) assert.equal(definition.schema.safeParse(definition.default).success, true, `${where}: default passes its schema`);
    assert.ok(definition.label.length >= 3 && AZ.test(definition.label + definition.description), `${where}: Azerbaijani label/description`);
    assert.ok(definition.description.length >= 20, `${where}: description`);
    assert.ok(SETTING_GROUPS[definition.group], `${where}: known group`);
    assert.match(definition.permission, /^settings\.(finance|content)$/, where);
    if (definition.input.kind === "percent" || definition.input.kind === "integer") {
      assert.ok(Number.isFinite(definition.input.min) && Number.isFinite(definition.input.max) && definition.input.min < definition.input.max, `${where}: numeric bounds`);
    } else {
      assert.ok(definition.input.maxLength > 0, `${where}: text bound`);
    }
    if (definition.sensitive) assert.ok(definition.sensitiveNotice && AZ.test(definition.sensitiveNotice), `${where}: sensitive notice`);
    assert.equal(getSettingDefinition(definition.key), definition);
  }
  assert.equal(getSettingDefinition("does.notExist"), undefined);
});

test("forbidden key names: secrets, keys, URLs, DSNs, 2FA, sessions, CSRF, proxy trust, roles and permissions never become settings", () => {
  for (const definition of SETTING_DEFINITIONS) {
    const lastPart = definition.key.split(".").pop() ?? "";
    const forbidden = FORBIDDEN_NAME.test(definition.key) || FORBIDDEN_NAME.test(lastPart);
    assert.ok(!forbidden || definition.key in FORBIDDEN_NAME_EXCEPTIONS, `${definition.key} matches the forbidden-name pattern`);
  }
  for (const [key, why] of Object.entries(FORBIDDEN_NAME_EXCEPTIONS)) {
    assert.ok(getSettingDefinition(key), `allowlisted ${key} must exist`);
    assert.ok(why.length >= 20, `allowlisted ${key} needs a written justification`);
  }
  // The pattern itself catches the obvious mistakes.
  for (const bad of ["auth.sessionSecret", "smtp.password", "epoint.apiKey", "google.clientKey", "app.baseUrl", "db.dsn", "admin.require2fa", "admin.totpWindow", "auth.sessionTtl", "csrf.trustedOrigins", "proxy.trustCloudflare", "users.defaultRole", "admin.permissions"]) {
    assert.ok(FORBIDDEN_NAME.test(bad), bad);
  }
  assert.equal(FORBIDDEN_NAME.test("commission.defaultRate"), false);
});

test("lib/settings never reads environment variables and is never imported by a client component", () => {
  const settingsFiles = readdirSync(join(root, "lib/settings")).map((name) => `lib/settings/${name}`);
  for (const file of settingsFiles) assert.doesNotMatch(read(file), ENV_ACCESS, file);
  const walk = (dir: string): string[] => readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    return statSync(join(root, path)).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [relative(".", path).replace(/\\/g, "/")] : [];
  });
  for (const file of [...walk("app"), ...walk("components")]) {
    const source = read(file);
    if (/^\s*["']use client["']/.test(source)) assert.doesNotMatch(source, /@\/lib\/settings\//, `${file} is a client component`);
  }
});

test("commission: percent input to decimal string with integer arithmetic; hard max 30%; step 0.01%", () => {
  assert.equal(percentToRate("10"), "0.1000");
  assert.equal(percentToRate("12.5"), "0.1250");
  assert.equal(percentToRate("12,75"), "0.1275");
  assert.equal(percentToRate("0.01"), "0.0001");
  assert.equal(percentToRate("0"), "0.0000");
  assert.equal(percentToRate("30"), "0.3000");
  assert.equal(percentToRate(" 7 "), "0.0700");
  for (const bad of ["30.01", "31", "100", "-1", "10.123", "abc", "", "1e1", "0x10", "10%"]) assert.equal(percentToRate(bad), null, bad);
  assert.equal(COMMISSION_MAX_BASIS_POINTS, 3000);
  for (const rate of ["0.1000", "0.1250", "0.0001", "0.0000", "0.3000", "0.0705"]) assert.equal(percentToRate(rateToPercent(rate)), rate, `round trip ${rate}`);
  assert.equal(rateToPercent("0.1000"), "10");
  assert.equal(rateToPercent("0.0705"), "7.05");

  const definition = getSettingDefinition("commission.defaultRate")!;
  assert.equal(definition.default, null, "ships with no default: identical to today");
  assert.equal(definition.sensitive, true);
  assert.equal(definition.read, "uncached");
  assert.equal(definition.permission, "settings.finance");
  assert.equal(definition.sensitiveNotice, "Yalnız bundan sonra yaradılan sifarişlərə tətbiq olunur; mövcud sifarişlər dəyişmir.");
  assert.deepEqual(definition.inputSchema.safeParse("10"), { success: true, data: "0.1000" });
  assert.equal(definition.inputSchema.safeParse(10).success, true, "a number is accepted and converted without float maths");
  assert.equal(definition.inputSchema.safeParse("45").success, false);
  assert.equal(definition.schema.safeParse(0.1).success, false, "a float is never a valid stored value");
  assert.equal(definition.schema.safeParse("0.3001").success, false);
  assert.equal(definition.display("0.1000"), "10%");
  assert.equal(definition.display(null), "Təyin edilməyib");
});

test("read path: missing, NULL or invalid stored values fall back to the default; invalid values are logged once a minute", () => {
  const definition: SettingDefinition<number> = {
    key: "test.limit", group: "finance", permission: "settings.content", sensitive: false, label: "Sınaq limiti", description: "Yalnız test üçün nümunə parametr.",
    schema: z.number().int().min(1).max(10), inputSchema: z.coerce.number().int().min(1).max(10), toInput: String, display: (v) => String(v ?? "—"),
    default: 5, input: { kind: "integer", min: 1, max: 10 }, read: "ttl",
  };
  const logs: string[] = [];
  const log = (line: string) => logs.push(line);
  assert.equal(resolveSettingValue(definition, undefined, 0, log), 5);
  assert.equal(resolveSettingValue(definition, null, 0, log), 5);
  assert.equal(resolveSettingValue(definition, 7, 0, log), 7);
  assert.equal(resolveSettingValue(definition, 99, 1_000, log), 5, "out of bounds");
  assert.equal(resolveSettingValue(definition, "7", 2_000, log), 5, "wrong type");
  assert.equal(logs.length, 1, "logged once in the minute");
  assert.equal(resolveSettingValue(definition, 99, 70_000, log), 5);
  assert.equal(logs.length, 2);
  assert.deepEqual(JSON.parse(logs[0]), { event: "site_setting.invalid_value", key: "test.limit" }, "the stored value itself is never logged");
});

test("read path wiring: cached table read through the fail-safe loader; uncached keys only inside a transaction", () => {
  const source = read("lib/settings/read.ts");
  assert.match(source, /createFailSafeLoader<Map<string, unknown>>\(\{[\s\S]*?ttlMs: SETTINGS_CACHE_TTL_MS,[\s\S]*?fallback: \(\) => new Map\(\),/);
  assert.match(source, /SETTINGS_CACHE_TTL_MS = 30_000/);
  assert.match(source, /if \(definition\.read !== "ttl"\) throw new Error/);
  assert.match(source, /export async function readSettingInTransaction<T = unknown>\(tx: Prisma\.TransactionClient, key: string\)/);
  assert.match(source, /tx\.siteSetting\.findUnique\(\{ where: \{ key \}/);
});
