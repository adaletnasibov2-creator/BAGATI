/**
 * Test helper: source of the admin section pages. app/admin/[...section]/page.tsx is a thin router; the sections
 * live in app/admin/_sections/*.tsx. Source-level tests read all of it together, so moving a section between those
 * files does not change what they check. Line endings are normalised (core.autocrlf checkouts have CRLF).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(__dirname, "..");

export function adminSectionSource(): string {
  const files = ["app/admin/[...section]/page.tsx", ...readdirSync(join(root, "app/admin/_sections")).filter((name) => /\.tsx?$/.test(name)).sort().map((name) => `app/admin/_sections/${name}`)];
  return files.map((file) => readFileSync(join(root, file), "utf8")).join("\n").replace(/\r\n/g, "\n");
}
