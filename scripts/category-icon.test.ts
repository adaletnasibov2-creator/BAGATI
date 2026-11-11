import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { categoryKind, categoryPhotoMap, type CategoryKind } from "../components/category-icon";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("category illustrations recognize Azerbaijani marketplace categories", () => {
  const cases = [
    ["Elektronika", "electronics"],
    ["Aksesuarlar", "accessories"],
    ["Ev və Məişət", "home"],
    ["Moda", "clothing"],
    ["Gözəllik və Sağlamlıq", "beauty"],
    ["İdman və Hobbi", "sports"],
    ["Uşaq Dünyası", "children"],
    ["Avtomobil", "automotive"],
    ["Kitablar", "books"],
    ["Ev heyvanları", "pets"],
    ["Digər", "other"],
  ] as const;

  for (const [name, expected] of cases) {
    assert.equal(categoryKind({ name }), expected, name);
  }
});

test("every category of the marketplace taxonomy maps to its own photograph", () => {
  // Names and slugs as created by prisma/seed.ts.
  const taxonomy: [string, string, CategoryKind][] = [
    ["Elektronika", "elektronika", "electronics"],
    ["Geyim", "geyim", "clothing"],
    ["Ev və məişət", "ev-ve-mesiet", "home"],
    ["Əyləncə", "eylence", "entertainment"],
    ["İdman", "idman", "sports"],
    ["Uşaq", "usaq", "children"],
    ["Gözəllik", "gozellik", "beauty"],
    ["Aksesuarlar", "aksesuarlar", "accessories"],
    ["Supermarket", "supermarket", "market"],
    ["Digər", "diger", "other"],
  ];

  const seen = new Set<string>();
  for (const [name, slug, expected] of taxonomy) {
    assert.equal(categoryKind({ name, slug }), expected, `${name} (${slug})`);
    assert.equal(categoryKind({ name }), expected, `${name} by name only`);
    assert.equal(categoryKind({ name: "", slug }), expected, `${slug} by slug only`);
    seen.add(categoryPhotoMap[expected].src);
  }
  assert.equal(seen.size, taxonomy.length, "no two categories share a photograph");
});

test("category photographs are distinct local files that exist on disk", () => {
  const entries = Object.entries(categoryPhotoMap);
  assert.equal(entries.length, 13);

  const sources = new Set<string>();
  for (const [kind, photo] of entries) {
    assert.equal(photo.src, `/images/categories/${kind}.webp`, kind);
    assert.ok(photo.content.trim().length > 0, `${kind} describes its photograph`);
    const file = resolve(root, "public", `.${photo.src}`);
    assert.ok(existsSync(file), `${photo.src} exists`);
    const bytes = readFileSync(file);
    assert.ok(statSync(file).size > 2000, `${photo.src} is not an empty placeholder`);
    assert.equal(bytes.subarray(0, 4).toString("latin1"), "RIFF", `${photo.src} is a WebP file`);
    assert.equal(bytes.subarray(8, 12).toString("latin1"), "WEBP", `${photo.src} is a WebP file`);
    sources.add(photo.src);
  }
  assert.equal(sources.size, entries.length);

  const component = readFileSync(resolve(root, "components/category-icon.tsx"), "utf8");
  assert.doesNotMatch(component, /https?:\/\//, "no category photograph depends on a remote host");
  assert.doesNotMatch(component, /backgroundImage/, "photographs are real image elements, not CSS backgrounds");
});

test("new categories use the neutral assorted-products photograph without changing their labels", () => {
  const category = { name: "Yeni bölmə", slug: "new-section" };
  assert.equal(categoryKind(category), "other");
  assert.equal(category.name, "Yeni bölmə");
  assert.equal(category.slug, "new-section");
});
