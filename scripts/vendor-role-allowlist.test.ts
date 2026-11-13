/**
 * Static guard: only approved code paths may give an account the VENDOR role.
 *
 *  1. lib/seller-application-service.ts — the admin approval transaction (approveSellerApplication).
 *  2. app/api/admin/vendors/route.ts    — an admin creates a seller account directly.
 *  3. prisma/migrations                 — none: the seller application backfill only inserts history rows.
 *
 * The test scans application code (app, lib, components, middleware, prisma seed) and operational scripts,
 * finds every Prisma user write (create, createMany, update, updateMany, upsert, including nested writes) whose
 * data sets `role`, and every raw SQL statement that writes the VENDOR role. Any VENDOR write outside the
 * allowlist, or a role taken from a variable in a non-allowlisted place, fails the test.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const root = join(__dirname, "..");
const SOURCE_DIRS = ["app", "lib", "components", "prisma", "scripts"];
const EXTENSIONS = /\.(ts|tsx|mts|js|mjs|cjs)$/;
/** Test files and isolated test harnesses create fixture users with any role on the verify database only. */
const EXCLUDED = [/\.test\.(ts|mjs)$/, /\.integration\.test\.ts$/, /^scripts\/auth-switch-browser-server\.ts$/];

const ALLOWED_VENDOR_WRITES = new Map<string, number>([
  ["lib/seller-application-service.ts", 1],
  ["app/api/admin/vendors/route.ts", 1],
]);

function files(dir: string): string[] {
  const absolute = join(root, dir);
  return readdirSync(absolute).flatMap((name) => {
    if (name === "node_modules" || name === ".next") return [];
    const path = join(absolute, name);
    if (statSync(path).isDirectory()) return files(join(dir, name));
    return EXTENSIONS.test(name) || name.endsWith(".sql") ? [relative(root, path).replace(/\\/g, "/")] : [];
  });
}

/** Text of the balanced (...) or {...} that starts at `open`. */
function balanced(text: string, open: number): string {
  const pairs: Record<string, string> = { "(": ")", "{": "}" };
  const close = pairs[text[open]];
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === text[open]) depth += 1;
    else if (text[index] === close) {
      depth -= 1;
      if (depth === 0) return text.slice(open, index + 1);
    }
  }
  return text.slice(open);
}

type RoleWrite = { file: string; value: string };

/** Values assigned to `role` inside the data / create / update objects of a Prisma user write. */
export function prismaRoleWrites(file: string, text: string): RoleWrite[] {
  const writes: RoleWrite[] = [];
  const call = /\buser\.(create|createMany|update|updateMany|upsert)\s*\(|\buser\s*:\s*\{\s*(create|update|upsert|connectOrCreate)\s*:/g;
  for (let match = call.exec(text); match; match = call.exec(text)) {
    const start = text.indexOf(match[0].endsWith("(") ? "(" : "{", match.index);
    const body = balanced(text, start);
    const dataKey = /\b(data|create|update)\s*:\s*\{/g;
    for (let key = dataKey.exec(body); key; key = dataKey.exec(body)) {
      const data = balanced(body, body.indexOf("{", key.index + key[0].length - 1));
      // Top-level `role` of this data object only (nested relation objects are their own matches).
      let depth = 0;
      for (let index = 1; index < data.length - 1; index += 1) {
        const char = data[index];
        if (char === "{" || char === "(" || char === "[") depth += 1;
        else if (char === "}" || char === ")" || char === "]") depth -= 1;
        else if (depth === 0 && /\brole\b/.test(data.slice(index, index + 4)) && !/[\w.$]/.test(data[index - 1] ?? "")) {
          const rest = data.slice(index + 4);
          const assigned = /^\s*:\s*([^,}\n]+)/.exec(rest);
          const shorthand = /^\s*[,}\n]/.test(rest);
          if (assigned) writes.push({ file, value: assigned[1].trim() });
          else if (shorthand) writes.push({ file, value: "role" });
        }
      }
    }
  }
  return writes;
}

/** Raw SQL that writes the VENDOR role: UPDATE "User" ... SET ... role = 'VENDOR', or INSERT INTO "User" ... 'VENDOR'. */
export function sqlRoleWrites(file: string, text: string): RoleWrite[] {
  const writes: RoleWrite[] = [];
  const update = /UPDATE\s+"?User"?\s+SET[\s\S]{0,300}?"?role"?\s*=\s*'VENDOR'/gi;
  const insert = /INSERT\s+INTO\s+"?User"?\s*\([^)]*\brole\b[^)]*\)[\s\S]{0,500}?'VENDOR'/gi;
  for (const pattern of [update, insert]) for (let m = pattern.exec(text); m; m = pattern.exec(text)) writes.push({ file, value: "'VENDOR' (SQL)" });
  return writes;
}

const isVendor = (value: string) => /^["'`]VENDOR["'`]$|^Role\.VENDOR$|'VENDOR' \(SQL\)$/.test(value);
const isLiteral = (value: string) => /^["'`][A-Z_]+["'`]$|^Role\.[A-Z_]+$/.test(value);

test("the scanner finds role writes and ignores role filters", () => {
  const sample = [
    'await tx.user.updateMany({ where: { id, role: "CUSTOMER" }, data: { role: "VENDOR" } });',
    'await db.user.count({ where: { role: "VENDOR" } });',
    'await prisma.user.create({ data: { email, role, vendorProfile: { create: { displayName } } } });',
    'await prisma.user.update({ where: { id }, data: { isActive: false } });',
    'await tx.vendorProfile.create({ data: { user: { create: { email, role: Role.VENDOR } } } });',
  ].join("\n");
  assert.deepEqual(prismaRoleWrites("x.ts", sample).map((write) => write.value), ['"VENDOR"', "role", "Role.VENDOR"]);
  assert.equal(sqlRoleWrites("x.sql", `UPDATE "User" SET "role" = 'VENDOR' WHERE id = 1`).length, 1);
  assert.equal(sqlRoleWrites("x.sql", `SELECT count(*) FROM "User" WHERE "role" = 'VENDOR'`).length, 0);
});

test("only the approval transaction and admin seller creation can set the VENDOR role", () => {
  const scanned = SOURCE_DIRS.flatMap(files).filter((file) => !EXCLUDED.some((pattern) => pattern.test(file)));
  assert.ok(scanned.length > 100, "the scan covers the codebase");
  const writes = scanned.flatMap((file) => {
    const text = readFileSync(join(root, file), "utf8");
    return file.endsWith(".sql") ? sqlRoleWrites(file, text) : [...prismaRoleWrites(file, text), ...sqlRoleWrites(file, text)];
  });

  const vendorWrites = writes.filter((write) => isVendor(write.value));
  const counts = new Map<string, number>();
  for (const write of vendorWrites) counts.set(write.file, (counts.get(write.file) ?? 0) + 1);
  assert.deepEqual(Object.fromEntries([...counts].sort()), Object.fromEntries([...ALLOWED_VENDOR_WRITES].sort()), "VENDOR role writes outside the allowlist");

  // A role taken from a variable could carry VENDOR; none may exist in application code.
  const dynamic = writes.filter((write) => !isLiteral(write.value));
  assert.deepEqual(dynamic, [], "role assigned from a variable");

  // The customer application route and its service function never write a role.
  const apply = readFileSync(join(root, "app/api/vendor/apply/route.ts"), "utf8");
  assert.deepEqual(prismaRoleWrites("apply", apply), []);
  assert.doesNotMatch(apply, /role: "VENDOR"/);
  const service = readFileSync(join(root, "lib/seller-application-service.ts"), "utf8");
  const submit = service.slice(service.indexOf("export async function submitSellerApplication"), service.indexOf("export async function withdrawSellerApplication"));
  assert.deepEqual(prismaRoleWrites("submit", submit), []);
  const approve = service.slice(service.indexOf("export async function approveSellerApplication"), service.indexOf("export async function rejectSellerApplication"));
  assert.equal(prismaRoleWrites("approve", approve).length, 1, "the one allowed write lives in approveSellerApplication");
});
