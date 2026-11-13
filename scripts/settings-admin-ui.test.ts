import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ADMIN_SETTINGS_TABS } from "../components/admin-settings-tabs";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("/admin/settings: the existing form stays the 'Ümumi' tab; 'Maliyyə' renders the settings-engine fields", () => {
  assert.deepEqual(ADMIN_SETTINGS_TABS.map((tab) => [tab.id, tab.label, tab.href]), [["general", "Ümumi", "/admin/settings"], ["finance", "Maliyyə", "/admin/settings?tab=finance"]]);
  const page = read("app/admin/[...section]/page.tsx");
  const branch = page.slice(page.indexOf(' if(route==="settings"){'), page.indexOf(' if(route==="homepage")'));
  assert.match(branch, /if\(sp\.tab==="finance"\)\{\s*const finance=await loadAdminSettingsGroup\(prisma,"finance"\);/);
  assert.match(branch, /<AdminSettingsTabs active="finance"\/>[\s\S]*?<AdminSettingField key=\{view\.key\} view=\{view\}\/>/);
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
  assert.match(admin, /restorable: item\.version !== row\?\.version && \(item\.value === null \|\| definition\.schema\.safeParse\(item\.value\)\.success\)/);
  assert.match(admin, /isDefault: stored === null \|\| storedValueInvalid/);
});
