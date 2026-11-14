/**
 * Phase C1 settings: contact (address, working hours, WhatsApp), footer (tagline, links) and maintenance mode.
 * Registry-level rules only (no database).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { FOOTER_LINKS_MAX, FOOTER_TAGLINE_DEFAULT, getSettingDefinition, MAINTENANCE_MESSAGE_DEFAULT, SETTING_GROUPS, SETTING_KEYS } from "../lib/settings/registry";

const def = (key: string) => {
  const definition = getSettingDefinition(key);
  assert.ok(definition, key);
  return definition;
};
const parseInput = (key: string, raw: unknown) => def(key).inputSchema.safeParse(raw);

test("new keys exist in their groups with the content permission", () => {
  for (const [key, group] of [["contact.address", "contact"], ["contact.workingHours", "contact"], ["contact.whatsapp", "contact"], ["footer.tagline", "footer"], ["footer.links", "footer"], ["maintenance.enabled", "maintenance"], ["maintenance.message", "maintenance"]] as const) {
    assert.equal(def(key).group, group, key);
    assert.equal(def(key).permission, "settings.content", key);
    assert.equal(def(key).read, "ttl", `${key}: 30 s cache`);
  }
  assert.ok(SETTING_GROUPS.contact && SETTING_GROUPS.footer && SETTING_GROUPS.maintenance);
  assert.equal(SETTING_KEYS.maintenanceEnabled, "maintenance.enabled");
});

test("defaults keep today's site: no address/hours/WhatsApp, the current footer tagline, the current links, maintenance off", () => {
  assert.equal(def("contact.address").default, null);
  assert.equal(def("contact.workingHours").default, null);
  assert.equal(def("contact.whatsapp").default, null);
  assert.equal(FOOTER_TAGLINE_DEFAULT, "Azərbaycan mağazalarını və məhsullarını bir məkanda kəşf et.");
  assert.ok(readFileSync(join(__dirname, "..", "components/customer-footer.tsx"), "utf8").includes("FOOTER_TAGLINE_DEFAULT") || readFileSync(join(__dirname, "..", "components/customer-footer.tsx"), "utf8").includes(FOOTER_TAGLINE_DEFAULT), "same text as the footer");
  assert.equal(def("footer.tagline").default, FOOTER_TAGLINE_DEFAULT);
  assert.equal(def("footer.links").default, null, "null = the current hard-coded links");
  assert.equal(def("maintenance.enabled").default, false);
  assert.equal(def("maintenance.message").default, MAINTENANCE_MESSAGE_DEFAULT);
});

test("WhatsApp number: Azerbaijani formats only", () => {
  assert.equal(parseInput("contact.whatsapp", "+994 55 123 45 67").success, true);
  assert.equal(parseInput("contact.whatsapp", "055 123 45 67").success, true);
  assert.equal(parseInput("contact.whatsapp", "+7 999 123 45 67").success, false);
  assert.equal(parseInput("contact.whatsapp", "salam").success, false);
});

test("contact texts are one line and length-bounded", () => {
  const address = parseInput("contact.address", "  Bakı,\n Nizami küç. 1  ");
  assert.equal(address.success && address.data, "Bakı, Nizami küç. 1");
  assert.equal(parseInput("contact.workingHours", "x".repeat(121)).success, false);
  assert.equal(parseInput("contact.address", "ab").success, false);
});

test("footer links: up to 6 rows of label + https or relative link; empty rows ignored; half rows and unsafe links rejected", () => {
  const ok = parseInput("footer.links", { label0: "Qaydalar", href0: "/terms", label1: "", href1: "", label2: "Instagram", href2: "https://instagram.com/bagati" });
  assert.equal(ok.success, true);
  assert.deepEqual(ok.success && ok.data, [{ label: "Qaydalar", href: "/terms" }, { label: "Instagram", href: "https://instagram.com/bagati" }]);
  for (const bad of ["javascript:alert(1)", "http://insecure.example", "//evil.example", "data:text/html,x", "https://user:pw@evil.example", " /terms"]) {
    assert.equal(parseInput("footer.links", { label0: "x", href0: bad }).success, bad === " /terms", `${bad} rejected`);
  }
  assert.equal(parseInput("footer.links", { label0: "Ad", href0: "" }).success, false, "label without link");
  assert.equal(parseInput("footer.links", { label0: "", href0: "/terms" }).success, false, "link without label");
  assert.equal(parseInput("footer.links", {}).success, false, "at least one row (use reset for the default)");
  assert.equal(parseInput("footer.links", { label0: "x".repeat(41), href0: "/terms" }).success, false, "label max 40");
  assert.equal(def("footer.links").schema.safeParse(Array.from({ length: FOOTER_LINKS_MAX + 1 }, () => ({ label: "a", href: "/a" }))).success, false, "max 6 stored");
  assert.deepEqual(def("footer.links").toForm?.([{ label: "A", href: "/a" }]).label0, "A");
});

test("maintenance switch: boolean, sensitive (reason + confirmation), message bounded", () => {
  const enabled = def("maintenance.enabled");
  assert.equal(enabled.input.kind, "toggle");
  assert.equal(enabled.sensitive, true);
  assert.match(enabled.sensitiveNotice ?? "", /503/);
  assert.deepEqual([parseInput("maintenance.enabled", "true"), parseInput("maintenance.enabled", false)].map((result) => result.success && result.data), [true, false]);
  assert.equal(parseInput("maintenance.enabled", "yes").success, false);
  assert.equal(parseInput("maintenance.message", "qısa").success, false, "min 10");
  assert.equal(parseInput("maintenance.message", "x".repeat(301)).success, false, "max 300");
});

test("admin field: toggle and links inputs, generic confirmation text for maintenance (commission wording unchanged)", () => {
  const field = readFileSync(join(__dirname, "..", "components/admin-setting-field.tsx"), "utf8");
  assert.match(field, /role="switch"/);
  assert.match(field, /<LinksEditor value=\{linkForm\}/);
  assert.match(field, /Dəyişikliyin yalnız yeni sifarişlərə tətbiq olunduğunu başa düşürəm\./);
  assert.match(field, /if \(key === "maintenance\.enabled"\) return "Texniki iş rejimində/);
});
