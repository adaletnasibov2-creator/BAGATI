import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ADMIN_SETTINGS_TABS } from "../components/admin-settings-tabs";
import { adminSectionSource } from "./admin-section-source";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("/admin/settings: the existing form stays the 'Ümumi' tab; 'Maliyyə' renders the settings-engine fields", () => {
  // Part 2 added SEO, Elan zolağı and Limitlər after the unchanged Ümumi and Maliyyə tabs.
  assert.deepEqual(ADMIN_SETTINGS_TABS.map((tab) => [tab.id, tab.label, tab.href]), [
    ["general", "Ümumi", "/admin/settings"],
    ["finance", "Maliyyə", "/admin/settings?tab=finance"],
    ["seo", "SEO", "/admin/settings?tab=seo"],
    ["announcement", "Elan zolağı", "/admin/settings?tab=announcement"],
    ["limits", "Limitlər", "/admin/settings?tab=limits"],
  ]);
  const page = adminSectionSource();
  const branch = page.slice(page.indexOf(' if(route==="settings"){'), page.indexOf(' if(route==="homepage")'));
  // Part 2: one generic branch renders every settings-engine group (finance unchanged in content).
  assert.match(branch, /const engineTab=\(\["finance","seo","announcement","limits"\] as const\)\.find\(tab=>tab===sp\.tab\);/);
  assert.match(branch, /const group=await loadAdminSettingsGroup\(prisma,engineTab\);/);
  assert.match(branch, /<AdminSettingsTabs active=\{engineTab\}\/>[\s\S]*?<AdminSettingField key=\{view\.key\} view=\{view\}\/>/);
  // The general tab is the same form with the same data as before the tabs.
  assert.match(branch, /const settings=await db\.siteSettings\.findUnique\(\{where:\{id:SITE_SETTINGS_DEFAULTS\.id\}\}\);[\s\S]*?<AdminSettingsTabs active="general"\/><AdminSiteSettingsForm initial=\{settings\?\?SITE_SETTINGS_DEFAULTS\}\/>/);
  assert.match(page, /const admin=await requireRole\("ADMIN"\);if\(!admin\)redirect\("\/admin\/login"\);/);
});

test("setting field: confirmation step, sensitive notice and reason, 409 refresh, reset and restore through the API", () => {
  const field = read("components/admin-setting-field.tsx");
  assert.match(field, /^"use client";/);
  assert.doesNotMatch(field, /@\/lib\/settings\//, "client component never imports lib/settings");
  assert.match(field, /url: `\/api\/admin\/settings\/\$\{encoded\}`, method: "PUT", body: \{ \.\.\.base, value: pending\.value \}/);
  assert.match(field, /url: `\/api\/admin\/settings\/\$\{encoded\}\/reset`, method: "POST"/);
  assert.match(field, /url: `\/api\/admin\/settings\/\$\{encoded\}\/restore`, method: "POST", body: \{ \.\.\.base, revisionId: pending\.revisionId \}/);
  assert.match(field, /expectedVersion: view\.version/);
  assert.match(field, /\.\.\.\(view\.sensitive \? \{ confirm: true \} : \{\}\)/);
  assert.match(field, /\{view\.sensitiveNotice && <p className="mt-2 font-medium">\{view\.sensitiveNotice\}<\/p>\}/);
  assert.match(field, /disabled=\{busy \|\| !reasonOk \|\| !confirmOk\}/);
  assert.match(field, /setConflict\(response\.status === 409 && result\.code === "VERSION_CONFLICT"\)/);
  assert.match(field, />Səhifəni yenilə</);
  assert.match(field, /Standart dəyər/);
  assert.match(field, /\(Bakı vaxtı\)/);
  assert.match(field, /Bu versiyanı bərpa et/);
});

test("admin view data: uncached database read, Baku times, restorable only when valid and not current", () => {
  const admin = read("lib/settings/admin.ts");
  assert.match(admin, /db\.siteSetting\.findMany\(/);
  assert.doesNotMatch(admin, /getSetting\(|loader/);
  assert.match(admin, /formatBakuDateTime\(row\.updatedAt\)/);
  assert.match(admin, /restorable: item\.version !== row\?\.version\s+&& JSON\.stringify\(item\.value \?\? null\) !== JSON\.stringify\(stored\)\s+&& \(item\.value === null \|\| definition\.schema\.safeParse\(item\.value\)\.success\)/);
  // The field shows the stored value again after a save (browser check found the typed text staying).
  // Part 2 also resets the announcement form state on refresh.
  assert.match(read("components/admin-setting-field.tsx"), /useEffect\(\(\) => \{ setValue\(view\.currentInput\); setForm\(toAnnouncementForm\(view\.currentForm\)\); \}, \[view\.version, view\.currentInput, view\.currentForm\]\);/);
  assert.match(admin, /isDefault: stored === null \|\| storedValueInvalid/);
});

test("Part 2 UI: inline validation mirrors the registry rules for text, integer and the announcement", async () => {
  const { settingInputIssue } = await import("../components/admin-setting-field");
  const text = { kind: "text" as const, minLength: 50, maxLength: 300 };
  assert.match(settingInputIssue(text, "Qısa"), /50–300 simvol yazın \(indi 4\)/);
  assert.equal(settingInputIssue(text, "x".repeat(60)), "");
  const template = { kind: "text" as const, minLength: 20, maxLength: 300, mustContain: "{store}" };
  assert.match(settingInputIssue(template, "Mağazanın məhsulları BAGATI-da"), /\{store\} yer tutucusu/);
  assert.equal(settingInputIssue(template, "{store} məhsulları BAGATI-da"), "");
  const integer = { kind: "integer" as const, min: 1, max: 50 };
  assert.equal(settingInputIssue(integer, "5"), "");
  for (const bad of ["0", "51", "2.5", "abc"]) assert.match(settingInputIssue(integer, bad), /1 ilə 50 arasında/, bad);
  const announcement = { kind: "announcement" as const, textMax: 200 };
  const form = { enabled: true, text: "Elan", href: "", tone: "info" as const, startsAt: "", endsAt: "" };
  assert.equal(settingInputIssue(announcement, form), "");
  assert.match(settingInputIssue(announcement, { ...form, text: " " }), /mətn yazın/);
  assert.equal(settingInputIssue(announcement, { ...form, enabled: false, text: "" }), "");
  assert.match(settingInputIssue(announcement, { ...form, text: "x".repeat(201) }), /200 simvol/);
  for (const href of ["javascript:alert(1)", "//evil.example", "http://example.com"]) assert.match(settingInputIssue(announcement, { ...form, href }), /HTTPS/, href);
  assert.equal(settingInputIssue(announcement, { ...form, href: "/products" }), "");
  assert.match(settingInputIssue(announcement, { ...form, startsAt: "2026-12-02T10:00", endsAt: "2026-12-01T10:00" }), /Bitmə vaxtı/);
});

test("Part 2 UI: 30-second note for cached settings, live announcement preview, no lib/settings in the client", () => {
  const field = read("components/admin-setting-field.tsx");
  assert.doesNotMatch(field, /@\/lib\/settings\//);
  assert.match(field, /\{view\.cached && <p className="text-slate-500">Dəyişiklik 30 saniyə ərzində tətbiq olunur\.<\/p>\}/);
  assert.match(field, /aria-label="Elan zolağının önizləməsi" className=\{`\$\{ANNOUNCEMENT_TONE_CLASSES\[value\.tone\]\}/, "preview uses the same tone styles as the live bar");
  assert.match(field, /<AnnouncementEditor value=\{form\} onChange=\{setForm\}/);
  assert.match(field, /disabled=\{busy \|\| Boolean\(issue\) \|\| empty\}/);
  const admin = read("lib/settings/admin.ts");
  assert.match(admin, /currentForm: definition\.toForm \? definition\.toForm\(value\) : null,/);
  assert.match(admin, /cached: definition\.read === "ttl",/);
});
