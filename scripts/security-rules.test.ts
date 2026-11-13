import assert from "node:assert/strict";
import test from "node:test";
import { effectiveRuleSettings, getAlertRule, incidentTitle, RULE_BOUNDS, ruleSettingsSchema, SECURITY_ALERT_RULES, shouldOpenIncident } from "../lib/security-monitoring/rules";
import { RETENTION, retentionCutoffs } from "../lib/security-monitoring/jobs";

test("the seven rules exist with Azerbaijani labels and defaults inside the bounds", () => {
  assert.deepEqual(SECURITY_ALERT_RULES.map((rule) => rule.key), ["login_failure_burst", "auth_denied_spike", "not_found_scan", "server_error_spike", "rate_limit_spike", "ip_header_mismatch", "two_factor_failures"]);
  for (const rule of SECURITY_ALERT_RULES) {
    assert.match(rule.key, /^[a-z][a-z0-9_]{1,47}$/, "matches the database CHECK");
    assert.match(rule.label + rule.description, /[əğıöşüçİ]/, `${rule.key}: Azerbaijani text`);
    assert.equal(ruleSettingsSchema.safeParse(rule.defaults).success, true, `${rule.key}: defaults valid`);
  }
  assert.deepEqual(RULE_BOUNDS, { threshold: [1, 100_000], windowMinutes: [1, 1440], cooldownMinutes: [1, 10_080] });
});

test("overrides: a database row (with key/version/updatedAt) is applied; an invalid one falls back to the default", () => {
  const rule = getAlertRule("server_error_spike")!;
  // Regression: the strict schema rejected the extra key field, so every override was silently ignored.
  const row = { key: "server_error_spike", enabled: true, threshold: 100, windowMinutes: 5, cooldownMinutes: 15, version: 2, updatedAt: new Date() } as never;
  assert.deepEqual(effectiveRuleSettings(rule, row), { enabled: true, threshold: 100, windowMinutes: 5, cooldownMinutes: 15, isDefault: false });
  assert.deepEqual(effectiveRuleSettings(rule, { enabled: true, threshold: 0, windowMinutes: 5, cooldownMinutes: 15 }), { ...rule.defaults, isDefault: true });
  assert.deepEqual(effectiveRuleSettings(rule, null), { ...rule.defaults, isDefault: true });
});

test("incident decision: enabled, threshold reached, outside the cooldown", () => {
  const settings = { enabled: true, threshold: 20, windowMinutes: 5, cooldownMinutes: 15 };
  const now = new Date("2026-11-14T12:00:00.000Z");
  assert.equal(shouldOpenIncident({ settings, value: 19, lastIncidentAt: null, now }), false);
  assert.equal(shouldOpenIncident({ settings, value: 20, lastIncidentAt: null, now }), true);
  assert.equal(shouldOpenIncident({ settings: { ...settings, enabled: false }, value: 99, lastIncidentAt: null, now }), false);
  assert.equal(shouldOpenIncident({ settings, value: 99, lastIncidentAt: new Date(now.getTime() - 14 * 60_000), now }), false, "inside cooldown");
  assert.equal(shouldOpenIncident({ settings, value: 99, lastIncidentAt: new Date(now.getTime() - 15 * 60_000), now }), true, "cooldown over");
  assert.equal(incidentTitle(getAlertRule("server_error_spike")!, 25, settings), "5xx server xətalarında artım: 25 (hədd 20, 5 dəq)");
});

test("retention periods: raw IP 7 days, minute stats 14, hourly 90", () => {
  assert.deepEqual(RETENTION, { rawIpDays: 7, minuteStatDays: 14, hourStatDays: 90 });
  const now = new Date("2026-11-14T00:00:00.000Z");
  const cutoffs = retentionCutoffs(now);
  assert.equal(cutoffs.rawIpBefore.toISOString(), "2026-11-07T00:00:00.000Z");
  assert.equal(cutoffs.minuteStatsBefore.toISOString(), "2026-10-31T00:00:00.000Z");
  assert.equal(cutoffs.hourStatsBefore.toISOString(), "2026-08-16T00:00:00.000Z");
});
