/**
 * Login email lookup (SCALE-FIX-2 A8): one probe of the unique index on lower(btrim(email)) instead of an ILIKE scan of
 * the User table. Only the lookup changed; every check after it stays in the three login routes.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { findUserByLoginEmail, type LoginUserLookupClient } from "../lib/login-user-lookup";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const ROUTES = ["app/api/auth/login/route.ts", "app/api/auth/vendor-login/route.ts", "app/api/admin/login/route.ts"];

function fakeDb(rows: { id: string }[]) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const found: unknown[] = [];
  const db = {
    $queryRaw: (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join("$"), values });
      return rows;
    }) as unknown as LoginUserLookupClient["$queryRaw"],
    user: {
      findUnique: (async (args: { where: { id: string } }) => { found.push(args); return { id: args.where.id, email: "ali@example.com" }; }) as unknown as LoginUserLookupClient["user"]["findUnique"],
    },
  } satisfies LoginUserLookupClient;
  return { db, calls, found };
}

test("the lookup is one parameterised query on the unique index expression, then the user by id", async () => {
  const { db, calls, found } = fakeDb([{ id: "u1" }]);
  const user = await findUserByLoginEmail(db, "ali@example.com");
  assert.deepEqual(user, { id: "u1", email: "ali@example.com" });
  assert.deepEqual(calls, [{ sql: 'SELECT "id" FROM "User" WHERE lower(btrim("email")) = $ LIMIT 1', values: ["ali@example.com"] }]);
  assert.deepEqual(found, [{ where: { id: "u1" } }]);
});

test("no matching row: null, and no second query", async () => {
  const { db, found } = fakeDb([]);
  assert.equal(await findUserByLoginEmail(db, "nobody@example.com"), null);
  assert.equal(found.length, 0);
});

test("the email is a bound parameter, never part of the SQL text", async () => {
  const { db, calls } = fakeDb([]);
  const hostile = `x' OR '1'='1"; DROP TABLE "User"; --@example.com`;
  await findUserByLoginEmail(db, hostile);
  assert.ok(!calls[0].sql.includes(hostile));
  assert.deepEqual(calls[0].values, [hostile]);
});

test("the query uses exactly the expression of the existing unique index (no migration needed)", () => {
  const migrations = join(process.cwd(), "prisma", "migrations");
  const sql = readdirSync(migrations).map((dir) => { try { return read(`prisma/migrations/${dir}/migration.sql`); } catch { return ""; } }).join("\n");
  assert.match(sql, /CREATE UNIQUE INDEX "User_email_normalized_key" ON "User"\(lower\(btrim\("email"\)\)\);/);
  assert.match(read("lib/login-user-lookup.ts"), /WHERE lower\(btrim\("email"\)\) = \$\{email\} LIMIT 1/);
});

test("the three login routes use it; the email is normalised first and every later check is still there", () => {
  for (const path of ROUTES) {
    const route = read(path);
    assert.doesNotMatch(route, /mode: "insensitive"/, path);
    assert.match(route, /const email = parsed\.data\.email\.trim\(\)\.toLowerCase\(\);/, path);
    // A lookup failure still answers 503 (the try/catch around the lookup is unchanged).
    assert.match(route, /try \{\s*user = await findUserByLoginEmail\(prisma, email\)[^\n]*\n?\s*\}?\s*catch \(error\) \{/, path);
    assert.ok(route.indexOf("await consumeAuthRateLimit(") > 0, path);
    assert.ok(route.indexOf("await consumeAuthRateLimit(") < route.indexOf("await findUserByLoginEmail("), `${path}: rate limit before the lookup`);
    assert.match(route, /if \(!user\) \{/, path);
    assert.match(route, /isActive/, path);
    assert.match(route, /bcrypt\.compare\(parsed\.data\.password, user\.passwordHash\)/, path);
  }
  const admin = read("app/api/admin/login/route.ts");
  assert.match(admin, /twoFactor|2fa|TwoFactor/i, "admin 2FA handling is still in the admin login route");
});
