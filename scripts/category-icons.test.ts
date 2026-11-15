import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as lucide from "lucide-react";
import {
  CATEGORY_ICONS,
  CATEGORY_ICON_KEYS,
  categoryIconComponent,
  effectiveIconKey,
  isCategoryIconKey,
  searchCategoryIcons,
} from "../lib/category-icons";
import { CATEGORY_SEED } from "../lib/category-seed";
import { categoryVisual, SEEDED_PHOTO_SLUGS } from "../components/category-icon";

test("every allowlisted key is a real lucide-react export with the same name", () => {
  for (const key of CATEGORY_ICON_KEYS) {
    const exported = (lucide as Record<string, unknown>)[key];
    assert.ok(exported, `${key} exists in the installed lucide-react`);
    assert.equal(CATEGORY_ICONS[key].Icon, exported, key);
    assert.ok(CATEGORY_ICONS[key].label.trim(), `${key} has an Azerbaijani label`);
    assert.match(key, /^[A-Za-z0-9]{1,40}$/, "matches Category_iconKey_format_check");
  }
});

test("the seed only uses allowlisted icons (the 15 icons of the brief, no substitutions)", () => {
  const used = CATEGORY_SEED.map((top) => top.iconKey);
  assert.deepEqual(new Set(used), new Set(["Watch", "Smartphone", "Sofa", "Shirt", "Sparkles", "ShoppingBasket", "Baby", "Dumbbell", "Gamepad2", "Car", "Hammer", "PawPrint", "Gift", "Gem", "Shapes"]));
  for (const key of used) assert.ok(isCategoryIconKey(key), key);
});

test("unknown keys are rejected and render no icon, never throw", () => {
  for (const value of ["", "nope", "toString", "__proto__", "constructor", null, undefined, 42, "smartphone"]) {
    assert.equal(isCategoryIconKey(value), false, String(value));
    assert.equal(categoryIconComponent(value as string | null), null, String(value));
  }
  assert.equal(categoryIconComponent("Car"), lucide.Car);
});

test("a subcategory without its own icon uses its parent's; unknown keys fall through", () => {
  assert.equal(effectiveIconKey({ iconKey: "Cat" }, { iconKey: "PawPrint" }), "Cat");
  assert.equal(effectiveIconKey({ iconKey: null }, { iconKey: "PawPrint" }), "PawPrint");
  assert.equal(effectiveIconKey({ iconKey: "bogus" }, { iconKey: "PawPrint" }), "PawPrint");
  assert.equal(effectiveIconKey({ iconKey: null }, null), null);
});

test("icon search matches keys and Azerbaijani labels", () => {
  assert.ok(searchCategoryIcons("pişik").includes("Cat"));
  assert.ok(searchCategoryIcons("car").includes("Car"));
  assert.equal(searchCategoryIcons("").length, CATEGORY_ICON_KEYS.length);
  assert.deepEqual(searchCategoryIcons("zzzz"), []);
});

test("visuals: existing photos unchanged before the seed; after the seed only listed slugs keep a photo", () => {
  // Before the seed (no iconKey): exactly the old name-based photo.
  assert.deepEqual(categoryVisual({ name: "Elektronika", slug: "elektronika" }), { kind: "photo", photo: "electronics" });
  assert.deepEqual(categoryVisual({ name: "Ev və məişət", slug: "ev-ve-mesiet", parentId: null, iconKey: null }), { kind: "photo", photo: "home" });
  // After the seed: launch categories + Avtomobil + Ev heyvanları keep/get a photo; other new top-levels an icon.
  for (const top of CATEGORY_SEED) {
    const visual = categoryVisual({ name: top.name, slug: top.slug, parentId: null, iconKey: top.iconKey });
    if (top.existing || top.slug === "avtomobil" || top.slug === "ev-heyvanlari") {
      assert.equal(visual.kind, "photo", top.slug);
    } else {
      assert.deepEqual(visual, { kind: "icon", iconKey: top.iconKey }, top.slug);
    }
  }
  assert.equal(Object.keys(SEEDED_PHOTO_SLUGS).length, 12);
  assert.deepEqual(categoryVisual({ name: "Avtomobil", slug: "avtomobil", iconKey: "Car" }), { kind: "photo", photo: "automotive" });
  assert.deepEqual(categoryVisual({ name: "Ev heyvanları", slug: "ev-heyvanlari", iconKey: "PawPrint" }), { kind: "photo", photo: "pets" });
  // Subcategories never use the name-based photo, even when the name would match it.
  assert.deepEqual(categoryVisual({ name: "Telefonlar", slug: "telefonlar", parentId: "x", iconKey: null, parentIconKey: "Smartphone" }), { kind: "icon", iconKey: "Smartphone" });
  // An admin upload wins everywhere.
  assert.deepEqual(categoryVisual({ name: "Keramika", slug: "keramika", parentId: "x", imageUrl: "/uploads/vendors/admin-home/a.webp" }), { kind: "upload", src: "/uploads/vendors/admin-home/a.webp" });
});

test("the icon module uses named lucide imports only (tree-shake friendly)", () => {
  const source = readFileSync(resolve(process.cwd(), "lib/category-icons.ts"), "utf8");
  assert.doesNotMatch(source, /import \* as/);
  assert.doesNotMatch(source, /lucide-react\/dynamic|DynamicIcon|icons\[/);
});
