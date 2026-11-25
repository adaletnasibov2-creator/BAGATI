/**
 * SEO-TITLES-1: titles, canonicals and sitemap entries for /deals, /new-products, /stores, /delivery-returns, /help
 * (+ /categories in the sitemap with its canonical). Titles are each page's own existing heading (owner: "mətnlər ok");
 * the root template adds the site name, so no page repeats it. Private pages stay noindex; robots.txt unchanged.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { SITEMAP_STATIC_PATHS, staticSitemapEntries, toSitemapXmlEntries } from "../lib/sitemap";
import { CONTENT_PAGE_DEFAULTS } from "../lib/content-pages";
import { isPrivateNoindexPath } from "../lib/private-noindex";
import { robotsConfig } from "../lib/structured-data";
import { withoutAllowedAdminChanges } from "./admin-power-1-scope";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const BASE = "1f6c86a";
const SITE = "https://shopbagati.com";
const PAGES = [
  { path: "/deals", title: "Endirimlər və kampaniyalar" },
  { path: "/new-products", title: "Yeni məhsullar" },
  { path: "/stores", title: "Mağazaları kəşf et" },
  { path: "/delivery-returns", title: "Çatdırılma" },
] as const;

async function metadataOf(path: string, args: unknown = {}) {
  const previous = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = SITE;
  try {
    const page = await import(`../app/(customer)${path}/page`) as { generateMetadata: (args?: unknown) => unknown };
    return await page.generateMetadata(args) as { title?: unknown; robots?: { index?: boolean; follow?: boolean }; alternates?: { canonical?: string } };
  } finally {
    if (previous === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = previous;
  }
}

test("titles are the pages' own headings; canonical is the clean absolute URL; index: true", async () => {
  for (const { path, title } of PAGES) {
    const metadata = await metadataOf(path);
    assert.equal(metadata.title, title, path);
    assert.ok(read(`app/(customer)${path}/page.tsx`).includes(`>${title}</h1>`), `${path}: the title is the existing h1`);
    assert.equal(metadata.alternates?.canonical, `${SITE}${path}`, path);
    assert.deepEqual(metadata.robots, { index: true, follow: true }, path);
    assert.doesNotMatch(String(metadata.title), /BAGATI|\|/, `${path}: no duplicated brand suffix (the root template adds it)`);
  }
});

test("/help: the help content page's own title (built-in 'Kömək mərkəzi' when no saved page), canonical, index", async () => {
  const errors = console.error; console.error = () => undefined; // the content-page read fails without a database here
  try {
    const metadata = await metadataOf("/help");
    assert.equal(metadata.title, CONTENT_PAGE_DEFAULTS.help.title);
    assert.equal(metadata.title, "Kömək mərkəzi");
    assert.equal(metadata.alternates?.canonical, `${SITE}/help`);
    assert.deepEqual(metadata.robots, { index: true, follow: true });
  } finally { console.error = errors; }
  // Same source as the visible heading (ContentPageView renders getPublicContentPage(slug).title).
  assert.match(read("app/(customer)/help/page.tsx"), /const page = await getPublicContentPage\("help"\);/);
  assert.match(read("components/content-page-view.tsx"), /const page = await getPublicContentPage\(slug\);[\s\S]*<LegalDocument title=\{page\.title\}/);
});

test("/categories (no category): title and description unchanged, + canonical and index", async () => {
  const metadata = await metadataOf("/categories", { searchParams: Promise.resolve({}) }) as { title?: unknown; description?: unknown; robots?: unknown; alternates?: { canonical?: string } };
  assert.equal(metadata.title, "Kateqoriyalar");
  assert.equal(metadata.description, "BAGATI kataloqunun bütün kateqoriyaları və alt kateqoriyaları.");
  assert.equal(metadata.alternates?.canonical, `${SITE}/categories`);
  assert.deepEqual(metadata.robots, { index: true, follow: true });
});

test("sitemap: the 6 pages are static entries, no duplicates, absolute URLs equal to the canonicals", () => {
  const added = ["/stores", "/deals", "/new-products", "/delivery-returns", "/help", "/categories"];
  for (const path of added) assert.ok((SITEMAP_STATIC_PATHS as readonly string[]).includes(path), path);
  assert.equal(new Set(SITEMAP_STATIC_PATHS).size, SITEMAP_STATIC_PATHS.length, "no duplicates");
  const urls = toSitemapXmlEntries(staticSitemapEntries(), SITE).map((entry) => entry.url);
  for (const path of added) assert.ok(urls.includes(`${SITE}${path}`), path);
  assert.equal(new Set(urls).size, urls.length);
  // Static: no database read added to the sitemap.
  assert.equal(execFileSync("git", ["diff", BASE, "--", "lib/sitemap.ts"], { cwd: root, encoding: "utf8" }).split("\n").filter((line) => /^\+[^+]/.test(line) && /prisma|findMany|\$query/.test(line)).length, 0);
});

test("private pages stay noindex; robots.txt, legal pages and /admin handling unchanged", () => {
  for (const path of ["/cart", "/checkout", "/account", "/orders", "/vendor", "/login", "/register"]) assert.equal(isPrivateNoindexPath(path), true, path);
  for (const path of ["/stores", "/deals", "/new-products", "/delivery-returns", "/help", "/categories"]) assert.equal(isPrivateNoindexPath(path), false, path);
  assert.equal((robotsConfig(SITE).rules as { disallow: string[] }).disallow.includes("/admin"), false);
  const changed = execFileSync("git", ["diff", "--name-only", BASE, "--", "lib/structured-data.ts", "lib/private-noindex.ts", "middleware.ts", "app/robots.ts", "app/admin", "app/(customer)/terms", "app/(customer)/privacy", "app/(customer)/seller-terms", "app/(customer)/about", "app/(customer)/contact"], { cwd: root, encoding: "utf8" }).trim();
  // ADMIN-DESIGN-1 / ADMIN-POWER-1 (owner-approved) may change their listed admin pages; app/admin/layout.tsx (noindex) is not one.
  assert.equal(withoutAllowedAdminChanges(changed), "");
});

test("no visible text changed: the pages only gained metadata lines", () => {
  for (const path of [...PAGES.map((page) => page.path), "/help", "/categories"]) {
    const diff = execFileSync("git", ["diff", BASE, "--", `app/(customer)${path}/page.tsx`], { cwd: root, encoding: "utf8" });
    const removed = diff.split("\n").filter((line) => /^-[^-]/.test(line));
    for (const line of removed) assert.match(line, /^-import |^-\s*if \(!slug\) return \{ title: "Kateqoriyalar"/, `${path}: only imports / the categories metadata line changed: ${line}`);
    const added = diff.split("\n").filter((line) => /^\+[^+]/.test(line) && !/^\+\s*\/\//.test(line)); // code comments aside
    // JSX would be an HTML tag (<h1, <p, </div>) or a component returned as markup; a type such as Promise<Metadata> is fine.
    for (const line of added) assert.doesNotMatch(line, /<\/?[a-z][\w-]*[\s>/]|return\s*<|^\+\s*<[A-Z]/, `${path}: no JSX added: ${line}`);
  }
});
