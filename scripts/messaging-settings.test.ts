/** Messaging settings (phase 3): six settings-engine keys in the "Mesajlaşma" group, read by lib/messaging-settings.ts. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { getSettingDefinition, SETTING_DEFINITIONS, SETTING_GROUPS, SETTING_KEYS } from "../lib/settings/registry";
import { MESSAGING_LIMIT_DEFAULTS } from "../lib/messaging";
import { loadMessagingSettings } from "../lib/messaging-settings";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

test("group and switches: Mesajlaşma, messaging OFF and contact details refused by default", () => {
  assert.equal(SETTING_GROUPS.messaging.label, "Mesajlaşma");
  for (const key of ["messaging.enabled", "messaging.allowContactDetails"]) {
    const definition = getSettingDefinition(key);
    assert.ok(definition, key);
    assert.equal(definition.group, "messaging");
    assert.equal(definition.default, false, `${key} default OFF`);
    assert.deepEqual(definition.input, { kind: "toggle" });
    assert.equal(definition.read, "ttl");
    assert.equal(definition.permission, "settings.content");
    assert.equal(definition.inputSchema.safeParse("true").success, true);
    assert.equal(definition.schema.safeParse("true").success, false, "stored as a real boolean");
  }
  assert.equal(getSettingDefinition("messaging.enabled")?.label, "Müştəri-mağaza mesajlaşması");
  assert.equal(getSettingDefinition("messaging.allowContactDetails")?.label, "Mesajda telefon və e-poçt");
});

test("limits: defaults equal the code defaults, bounded, limits permission", () => {
  const keys = {
    customerMessagesPerHour: SETTING_KEYS.messagingCustomerMessagesPerHour,
    customerNewConversationsPerDay: SETTING_KEYS.messagingCustomerNewConversationsPerDay,
    storeMessagesPerHour: SETTING_KEYS.messagingStoreMessagesPerHour,
    storeIncomingPerHour: SETTING_KEYS.messagingStoreIncomingPerHour,
  } as const;
  for (const [name, key] of Object.entries(keys) as [keyof typeof keys, string][]) {
    const definition = getSettingDefinition(key);
    assert.ok(definition, key);
    assert.equal(definition.group, "messaging");
    assert.equal(definition.permission, "settings.limits");
    assert.equal(definition.default, MESSAGING_LIMIT_DEFAULTS[name], `${key} default`);
    assert.equal(definition.input.kind, "integer");
    assert.equal(definition.inputSchema.safeParse(0).success, false, `${key} refuses 0`);
    assert.equal(definition.inputSchema.safeParse(String(MESSAGING_LIMIT_DEFAULTS[name])).success, true);
  }
  assert.equal(SETTING_DEFINITIONS.filter((definition) => definition.group === "messaging").length, 6);
});

test("loader: only a stored true switches on; missing or bad limit values fall back to the defaults", async () => {
  const values = (map: Record<string, unknown>) => async (key: string) => map[key];
  assert.deepEqual(await loadMessagingSettings(values({})), { enabled: false, allowContactDetails: false, limits: { ...MESSAGING_LIMIT_DEFAULTS } });
  const on = await loadMessagingSettings(values({ "messaging.enabled": true, "messaging.allowContactDetails": true, "limits.messaging.customerMessagesPerHour": 5, "limits.messaging.storeIncomingPerHour": 0, "limits.messaging.storeMessagesPerHour": "50" }));
  assert.equal(on.enabled, true);
  assert.equal(on.allowContactDetails, true);
  assert.equal(on.limits.customerMessagesPerHour, 5);
  assert.equal(on.limits.storeIncomingPerHour, MESSAGING_LIMIT_DEFAULTS.storeIncomingPerHour, "0 is not a valid limit");
  assert.equal(on.limits.storeMessagesPerHour, MESSAGING_LIMIT_DEFAULTS.storeMessagesPerHour, "strings are not numbers");
  for (const value of ["true", 1, null]) assert.equal((await loadMessagingSettings(values({ "messaging.enabled": value }))).enabled, false, String(value));
  assert.match(read("lib/messaging-settings.ts"), /const cachedRead: SettingReader = \(key\) => getSetting\(key\);/);
});

test("admin tab: Mesajlaşma renders the group with the generic settings-engine page", () => {
  assert.match(read("components/admin-settings-tabs.tsx"), /\{ id: "messaging", label: "Mesajlaşma", href: "\/admin\/settings\?tab=messaging" \}/);
  assert.match(read("app/admin/_sections/settings.tsx"), /"orders","messaging"\] as const\)\.find\(tab=>tab===sp\.tab\)/);
});
