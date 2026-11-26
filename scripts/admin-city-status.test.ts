/**
 * ADMIN-3-TODAY-1, commit 2: the city status control on /admin/cities did the opposite of its label (an unticked
 * "Deaktiv et" checkbox; saving unticked deactivated, ticking kept the city active). Now one button sends the opposite
 * of the current state as a boolean, asks the approved question only before deactivating, and reuses existing words.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { CITY_STATUS_TEXT, cityStatusButtonLabel, cityStatusConfirm, cityStatusPayload } from "../lib/admin-city-status";

const root = process.cwd();
const BASE = "17815d0";
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
// This commit (the city fix) and the previous one of the task; before the commit: working tree.
const TASK = git("log", "--format=%H", "--grep=^ADMIN-3-TODAY-1: city", `${BASE}..HEAD`).trim().split(/\r?\n/).filter(Boolean)[0] ?? null;
const atTask = (path: string) => (TASK ? git("show", `${TASK}:${path}`).replace(/\r\n/g, "\n") : read(path));
const atBase = (path: string) => { try { return git("show", `${BASE}:${path}`).replace(/\r\n/g, "\n"); } catch { return ""; } };

test("the button does what its label says: active -> 'Deaktiv et' sends false; inactive -> 'Aktiv et' sends true", () => {
  assert.equal(cityStatusButtonLabel(true), "Deaktiv et");
  assert.deepEqual(cityStatusPayload("city-1", true), { id: "city-1", isActive: false });
  assert.equal(cityStatusButtonLabel(false), "Aktiv et");
  assert.deepEqual(cityStatusPayload("city-1", false), { id: "city-1", isActive: true });
  for (const current of [true, false]) assert.equal(typeof cityStatusPayload("c", current).isActive, "boolean", "a real boolean, as the API schema expects");
  // The route still accepts exactly a boolean for isActive.
  assert.match(read("app/api/admin/[...resource]/route.ts"), /section === "cities"\) \{\s*const parsed = z\.object\(\{[^\n]*isActive: z\.boolean\(\)\.optional\(\)/);
});

test("deactivating asks the owner-approved question first; activating does not", () => {
  assert.equal(cityStatusConfirm(true), "Şəhəri deaktiv etsəniz, bu şəhərdəki bütün mağazalar saytda görünməyəcək. Davam edək?");
  assert.equal(cityStatusConfirm(false), null);
  const button = atTask("components/admin-city-status-button.tsx");
  assert.match(button, /import \{ useConfirmDialog \} from "@\/components\/admin-ui\/confirm-dialog";/);
  const ask = button.indexOf("if (question && !(await confirm(question))) return;");
  assert.ok(ask > 0 && ask < button.indexOf("await fetch("), "asks before the request");
  assert.match(button, /fetch\("\/api\/admin\/cities", \{ method: "PATCH", headers: \{ "Content-Type": "application\/json" \}, body: JSON\.stringify\(cityStatusPayload\(cityId, isActive\)\) \}\)/);
  assert.match(button, /<button type="button" disabled=\{busy\} onClick=\{\(\) => void toggle\(\)\}/);
  assert.match(button, /\{dialog\}/);
});

test("the cities page uses the button; the inverted checkbox is gone", () => {
  const page = atTask("app/admin/_sections/cities.tsx");
  assert.match(page, /<AdminCityStatusButton cityId=\{r\.id\} isActive=\{r\.isActive\}\/>/);
  assert.doesNotMatch(page, /name:"isActive"/, "no isActive checkbox field any more");
  assert.doesNotMatch(page, /type:"checkbox"/);
  // The rename form is unchanged.
  assert.ok(page.includes('{name:"name",label:"Ad",value:r.name,required:true},{name:"slug",label:"Slug",value:r.slug,required:true}'));
});

test("no new visible text: every word already existed (cities page, the generic admin form)", () => {
  const AZ = /[əğıöüşçƏĞİÖÜŞÇ]/;
  const fragments = (source: string) => new Set(source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*\*|\{\/\*)/.test(line)).join("\n").split(/["'`<>{}]|\$\{/).map((part) => part.trim()).filter((part) => AZ.test(part)));
  const existing = new Set([...fragments(atBase("app/admin/_sections/cities.tsx")), ...fragments(atBase("components/admin-mutation-form.tsx"))]);
  // The three texts were on the cities page before ("Deaktiv et"/"Aktiv et" have no Azerbaijani-only letters, so they
  // are checked as plain text in the base source).
  const baseCities = atBase("app/admin/_sections/cities.tsx");
  for (const text of Object.values(CITY_STATUS_TEXT)) assert.ok(baseCities.includes(`"${text}"`), `existing: ${text}`);
  for (const path of ["lib/admin-city-status.ts", "components/admin-city-status-button.tsx", "app/admin/_sections/cities.tsx"]) {
    const added = [...fragments(atTask(path))].filter((part) => !existing.has(part));
    assert.deepEqual(added, [], `${path}: new Azerbaijani text`);
  }
  if (TASK) {
    const parent = git("rev-parse", `${TASK}^`).trim();
    const files = git("diff", "--name-only", parent, TASK).split(/\r?\n/).filter(Boolean).sort();
    // + two older tests updated for the new component: admin-ui-kit (dialog users list) and order-notify-1 (admin
    // components listed at its own commit).
    assert.deepEqual(files, ["app/admin/_sections/cities.tsx", "components/admin-city-status-button.tsx", "lib/admin-city-status.ts", "scripts/admin-city-status.test.ts", "scripts/admin-ui-kit.test.ts", "scripts/order-notify-1.test.ts"]);
  }
});
