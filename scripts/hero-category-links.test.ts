import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { INITIAL_CATEGORIES } from "../lib/reference-data";

test("every hero carousel category link points at a real launch category slug", () => {
  const source = readFileSync(resolve(process.cwd(), "components/home/hero-carousel.tsx"), "utf8");
  const slugs = [...source.matchAll(/\/products\?category=([a-z0-9-]+)/g)].map((match) => match[1]);
  assert.ok(slugs.length >= 4);
  const known = new Set<string>(INITIAL_CATEGORIES.map((category) => category.slug));
  for (const slug of slugs) assert.ok(known.has(slug), `unknown category slug in hero carousel: ${slug}`);
});
