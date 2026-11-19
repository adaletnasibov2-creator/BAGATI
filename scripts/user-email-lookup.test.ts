/**
 * SCALE-FIX-3, A8 follow-up: registration, forgot-password and the existing-account check look the email up through the
 * unique index on lower(btrim(email)) (lib/login-user-lookup.ts findUserIdsByNormalizedEmail) instead of an ILIKE scan.
 * Behaviour and the anti-enumeration answers stay as they were: only the lookup changed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { findUserIdsByNormalizedEmail, type UserEmailLookupClient } from "../lib/login-user-lookup";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

function fakeDb(rows: { id: string }[]) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const db = {
    $queryRaw: (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join("$"), values });
      return rows;
    }) as unknown as UserEmailLookupClient["$queryRaw"],
  } satisfies UserEmailLookupClient;
  return { db, calls };
}

test("one parameterised query on the unique index expression; Postgres normalises both sides", async () => {
  const { db, calls } = fakeDb([{ id: "u1" }]);
  assert.deepEqual(await findUserIdsByNormalizedEmail(db, "  Ali@Example.com "), ["u1"]);
  assert.deepEqual(calls, [{ sql: 'SELECT "id" FROM "User" WHERE lower(btrim("email")) = lower(btrim($)) LIMIT 1', values: ["  Ali@Example.com "] }]);
});

test("limit 2 (existing-account check) reads at most two ids; no match gives an empty list", async () => {
  const two = fakeDb([{ id: "a" }, { id: "b" }]);
  assert.deepEqual(await findUserIdsByNormalizedEmail(two.db, "x@example.com", 2), ["a", "b"]);
  assert.match(two.calls[0].sql, /LIMIT 2$/);
  const none = fakeDb([]);
  assert.deepEqual(await findUserIdsByNormalizedEmail(none.db, "nobody@example.com"), []);
});

test("the email is a bound parameter, never SQL text; _ and % are ordinary characters (no LIKE)", async () => {
  const { db, calls } = fakeDb([]);
  const hostile = `a_b%' OR '1'='1"; DROP TABLE "User"; --@example.com`;
  await findUserIdsByNormalizedEmail(db, hostile);
  assert.ok(!calls[0].sql.includes(hostile));
  assert.deepEqual(calls[0].values, [hostile]);
  assert.doesNotMatch(calls[0].sql, /LIKE/i);
});

test("register: both lookups use the index probe; rate limits first; same acknowledgement for new and existing", () => {
  const route = read("app/api/auth/register/route.ts");
  assert.doesNotMatch(route, /mode: "insensitive"/);
  assert.equal((route.match(/await findRegistrationUser\(email\)/g) ?? []).length, 2, "first lookup and the duplicate-email retry");
  assert.match(route, /findUserIdsByNormalizedEmail\(prisma, email\)/);
  assert.match(route, /select: \{ id: true, passwordHash: true, role: true, emailVerifiedAt: true \}/);
  assert.ok(route.indexOf("consumeAuthProcessRateLimit(") < route.indexOf("await findRegistrationUser(email)"));
  assert.ok(route.indexOf("await consumeAuthRateLimit(") < route.indexOf("await findRegistrationUser(email)"));
  // Existing account → the same acknowledgement as a new account (anti-enumeration), and a lookup failure → 503.
  assert.match(route, /if \(exists\) \{[\s\S]*?return registrationAcknowledgement\(userId, "CUSTOMER", "\/verify-email"\);/);
  assert.match(route, /catch \(error\) \{ logAuthFailure\("customer_registration_lookup", error\); return NextResponse\.json\([^;]*status: 503/);
  assert.match(route, /const email = parsed\.data\.email\.toLowerCase\(\);/);
});

test("forgot-password: index probe, then only an ACTIVE user by id; the generic 202 answer is unchanged", () => {
  const route = read("app/api/auth/forgot-password/route.ts");
  assert.doesNotMatch(route, /mode: "insensitive"/);
  assert.match(route, /const \[userId\] = await findUserIdsByNormalizedEmail\(prisma, email\);/);
  assert.match(route, /where: \{ id: userId, isActive: true \},\s*select: \{ id: true, email: true, passwordAuthEnabled: true \}/);
  assert.ok(route.indexOf("await consumeAuthRateLimit(") < route.indexOf("await findUserIdsByNormalizedEmail("), "rate limit before the lookup");
  assert.match(route, /if \(!user \|\| !user\.passwordAuthEnabled\) return NextResponse\.json\(genericResponse, \{ status: 202/);
  // Every non-error outcome answers with the same generic body and 202.
  assert.equal((route.match(/NextResponse\.json\(genericResponse, \{ status: 202, headers: \{ "Cache-Control": "no-store" \} \}\)/g) ?? []).length, 3);
});

test("existing-account check: index probe with limit 2, the ambiguous branch kept, then the row by id", () => {
  const lib = read("lib/existing-account.ts");
  assert.doesNotMatch(lib, /mode: "insensitive"/);
  assert.match(lib, /findUserIdsByNormalizedEmail\(prisma, email, 2\)/);
  assert.match(lib, /if \(ids\.length === 0\) return \{ kind: "none" \};/);
  assert.match(lib, /if \(ids\.length > 1\) return \{ kind: "ambiguous" \};/);
  assert.match(lib, /findUnique\(\{ where: \{ id: ids\[0\] \}, select: \{ id: true, role: true, isActive: true \} \}\)/);
});
