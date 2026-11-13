import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { getSettingDefinition } from "../lib/settings/registry";
import { requireSettingPermission, settingPermissionsFor } from "../lib/settings/permissions";
import { auditValue, checkSensitive, displaySettingValue, SETTING_ERROR_RESPONSES, SettingError } from "../lib/settings/write";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const indexes = (text: string, needles: string[]) => needles.map((needle) => {
  const index = text.indexOf(needle);
  assert.ok(index >= 0, `missing: ${needle}`);
  return index;
});
const ascending = (values: number[]) => values.every((value, i) => i === 0 || value > values[i - 1]);

test("routes: same-origin, then ADMIN, then the shared handler; handler: permission, bounded body, unknown key, then the write", () => {
  for (const [path, method, action] of [["app/api/admin/settings/[key]/route.ts", "PUT", "update"], ["app/api/admin/settings/[key]/reset/route.ts", "POST", "reset"], ["app/api/admin/settings/[key]/restore/route.ts", "POST", "rollback"]] as const) {
    const route = read(path);
    assert.ok(ascending(indexes(route, ["csrfRejection(request)", 'requireRole("ADMIN")', `handleSettingWrite(request, admin, (await params).key, "${action}")`])), path);
    assert.match(route, new RegExp(`export async function ${method}\\(`));
    assert.equal((route.match(/export async function/g) ?? []).length, 1, `${path}: one method only`);
  }
  const handler = read("lib/settings/http.ts");
  assert.ok(ascending(indexes(handler, [
    "requireSettingPermission(admin, definition?.permission ?? null)",
    "readJsonBodyLimited(request, SETTINGS_BODY_BYTES)",
    'if (!definition) return settingJson({ error: SETTING_ERROR_RESPONSES.UNKNOWN_KEY.error, code: "UNKNOWN_KEY" }, 404);',
    "updateSetting(prisma",
    "invalidateSettingsCache();",
  ])));
  assert.match(handler, /SETTINGS_BODY_BYTES = 8 \* 1024/);
});

test("write service: one transaction with row lock, version check, revision with previous value and audit old -> new", () => {
  const write = read("lib/settings/write.ts");
  const apply = write.slice(write.indexOf("async function applyChange"), write.indexOf("/** New value from the admin form"));
  assert.ok(ascending(indexes(apply, [
    "const reason = checkSensitive(definition, change);",
    "db.$transaction(async (tx) => {",
    'SELECT "value", "version" FROM "SiteSetting" WHERE "key" = ${definition.key} FOR UPDATE',
    'if (change.expectedVersion !== currentVersion) throw new SettingError("VERSION_CONFLICT");',
    'throw new SettingError("NO_CHANGE")',
    "tx.siteSetting.updateMany({ where: { key: definition.key, version: currentVersion }",
    "tx.siteSettingRevision.create({",
    'action: "SITE_SETTING_UPDATE"',
  ])));
  assert.match(apply, /previousValue: previous === null \? Prisma\.DbNull/);
  assert.match(apply, /from: auditValue\(previous\),\s+to: auditValue\(next\),/);
  assert.match(apply, /"P2002"\) throw new SettingError\("VERSION_CONFLICT"\)/);
  // Rollback and reset are new versions; nothing deletes or updates a revision.
  assert.doesNotMatch(write, /siteSettingRevision\.(update|updateMany|delete|deleteMany|upsert)/);
  assert.match(write, /applyChange\(db, definition, change, "ROLLBACK"/);
  assert.match(write, /applyChange\(db, definition, change, "RESET", async \(\) => null\)/);
});

test("sensitive keys need confirm: true and a 10–500 character reason", () => {
  const commission = getSettingDefinition("commission.defaultRate")!;
  const code = (fn: () => unknown) => { try { fn(); return "OK"; } catch (error) { return error instanceof SettingError ? error.code : "OTHER"; } };
  assert.equal(code(() => checkSensitive(commission, {})), "CONFIRM_REQUIRED");
  assert.equal(code(() => checkSensitive(commission, { confirm: false, reason: "Şura qərarı ilə 10%" })), "CONFIRM_REQUIRED");
  assert.equal(code(() => checkSensitive(commission, { confirm: true })), "REASON_REQUIRED");
  assert.equal(code(() => checkSensitive(commission, { confirm: true, reason: "  qısa  " })), "REASON_REQUIRED");
  assert.equal(code(() => checkSensitive(commission, { confirm: true, reason: "x".repeat(501) })), "REASON_REQUIRED");
  assert.equal(checkSensitive(commission, { confirm: true, reason: "  Sahibkarın qərarı: 10%  " }), "Sahibkarın qərarı: 10%");
  const plain = { ...commission, sensitive: false };
  assert.equal(checkSensitive(plain, {}), null, "non-sensitive: reason optional");
  assert.equal(code(() => checkSensitive(plain, { reason: "x".repeat(501) })), "REASON_REQUIRED");
  assert.equal(SETTING_ERROR_RESPONSES.VERSION_CONFLICT.status, 409);
  assert.equal(SETTING_ERROR_RESPONSES.UNKNOWN_KEY.status, 404);
});

test("audit values: long texts shortened, display tolerates invalid stored values", () => {
  assert.equal(auditValue("0.1000"), "0.1000");
  assert.equal(auditValue(null), null);
  const long = auditValue("x".repeat(500));
  assert.equal(typeof long, "string");
  assert.ok((long as string).startsWith("x".repeat(200)) && (long as string).endsWith("(500 simvol)"));
  const commission = getSettingDefinition("commission.defaultRate")!;
  assert.equal(displaySettingValue(commission, "0.1250"), "12.5%");
  assert.equal(displaySettingValue(commission, null), "Təyin edilməyib");
  assert.equal(displaySettingValue(commission, 0.1), "yanlış dəyər");
});

test("permission hook: ADMIN holds every settings permission; other roles none; unknown keys need all permissions", () => {
  // Part 2 added settings.limits; ADMIN holds all three today.
  assert.deepEqual([...settingPermissionsFor("ADMIN")].sort(), ["settings.content", "settings.finance", "settings.limits"]);
  assert.equal(requireSettingPermission({ role: "ADMIN" }, "settings.limits"), true);
  assert.deepEqual(settingPermissionsFor("VENDOR"), []);
  assert.deepEqual(settingPermissionsFor("CUSTOMER"), []);
  assert.equal(requireSettingPermission({ role: "ADMIN" }, "settings.finance"), true);
  assert.equal(requireSettingPermission({ role: "ADMIN" }, null), true);
  assert.equal(requireSettingPermission({ role: "VENDOR" }, "settings.content"), false);
  assert.equal(requireSettingPermission({ role: "CUSTOMER" }, null), false);
});
