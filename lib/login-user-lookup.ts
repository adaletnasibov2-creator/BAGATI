/**
 * Login user lookup by the normalised email (SCALE-FIX-2 A8).
 *
 * Before: prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } }). Prisma sends that as
 * `"email" ILIKE $1`, which no index can serve, so every login attempt scanned the whole User table (SCALE-1: a
 * sequential scan, 8 ms at 20k users, growing with every user and repeated for every failed or scripted attempt).
 *
 * Now: `lower(btrim("email")) = $1`, which is exactly the expression of the unique index "User_email_normalized_key"
 * (migration 20261014003000_secure_account_recovery). The index makes it one index probe, and its uniqueness means at
 * most one user can match, so the result no longer depends on which row Postgres happens to return first.
 *
 * Same accounts as before for every real address: the routes pass the email trimmed and lower-cased, so a stored
 * email matched the old ILIKE when its lower-cased value equals the input, and then lower(btrim(stored)) equals it as
 * well. Two differences, both checked on PostgreSQL (scripts/scale-fix-2.integration.test.ts):
 *   - the old ILIKE treated `_` and `%` in the typed email as wildcards ("a_b@x" found the account "axb@x"); now they
 *     are ordinary characters, so a typed pattern can no longer reach another account;
 *   - a stored email with surrounding spaces is now found (the unique index already treats it as that address).
 *
 * Only the lookup changed: the routes keep every check that follows (active, password, role/portal, email
 * verification, admin 2FA, rate limits, audit and security events).
 */
import type { PrismaClient, User } from "@prisma/client";

export type LoginUserLookupClient = Pick<PrismaClient, "$queryRaw"> & { user: Pick<PrismaClient["user"], "findUnique"> };

/** `email` must already be trimmed and lower-cased (the login routes do this before rate limiting). */
export async function findUserByLoginEmail(db: LoginUserLookupClient, email: string): Promise<User | null> {
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "User" WHERE lower(btrim("email")) = ${email} LIMIT 1`;
  if (!rows.length) return null;
  return db.user.findUnique({ where: { id: rows[0].id } });
}

export type UserEmailLookupClient = Pick<PrismaClient, "$queryRaw">;

/**
 * SCALE-FIX-3 (A8 follow-up): the same index probe for registration, forgot-password and the existing-account check,
 * which still used `email: { equals, mode: "insensitive" }` (an ILIKE scan of User, with `_`/`%` as wildcards).
 *
 * Returns the ids of the users whose normalised email equals the normalised input. Postgres normalises both sides with
 * lower(btrim(...)), exactly like the unique index "User_email_normalized_key", so the result is the same however the
 * caller cased or trimmed the input, and the index serves it (the right-hand side is a constant for the planner).
 * Because the index is unique there is at most one id; `limit: 2` exists only so the existing-account check keeps its
 * "ambiguous" branch unchanged. Callers then read the row by id with their own select and filters.
 */
export async function findUserIdsByNormalizedEmail(db: UserEmailLookupClient, email: string, limit: 1 | 2 = 1): Promise<string[]> {
  const rows = limit === 2
    ? await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "User" WHERE lower(btrim("email")) = lower(btrim(${email})) LIMIT 2`
    : await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "User" WHERE lower(btrim("email")) = lower(btrim(${email})) LIMIT 1`;
  return rows.map((row) => row.id);
}

