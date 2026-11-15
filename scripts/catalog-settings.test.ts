import assert from "node:assert/strict";
import test from "node:test";
import { getSettingDefinition, SETTING_GROUPS, SETTING_KEYS } from "../lib/settings/registry";

test("catalog.showEmptyCategories: Kataloq group, boolean toggle, default ON, cached read", () => {
  assert.equal(SETTING_KEYS.catalogShowEmptyCategories, "catalog.showEmptyCategories");
  const definition = getSettingDefinition("catalog.showEmptyCategories");
  assert.ok(definition);
  assert.equal(definition.group, "catalog");
  assert.equal(SETTING_GROUPS.catalog.label, "Kataloq");
  assert.equal(definition.label, "Boş kateqoriyaları göstər");
  assert.equal(definition.default, true);
  assert.equal(definition.read, "ttl");
  assert.deepEqual(definition.input, { kind: "toggle" });
  assert.equal(definition.permission, "settings.content");
  assert.equal(definition.sensitive, false);
  for (const [input, expected] of [[true, true], [false, false], ["true", true], ["false", false]] as const) {
    const parsed = definition.inputSchema.safeParse(input);
    assert.ok(parsed.success);
    assert.equal(parsed.data, expected);
  }
  assert.equal(definition.inputSchema.safeParse("yes").success, false);
  assert.equal(definition.schema.safeParse("true").success, false, "stored value is a real boolean");
});
