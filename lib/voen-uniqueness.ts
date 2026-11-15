/**
 * One VÖEN per seller account. A VÖEN may not be used by two different users: neither by another seller's
 * VendorProfile nor by another user's open (PENDING) application. One seller's own stores share the profile VÖEN,
 * and a user's own re-application is not a conflict.
 *
 * App-level (not a unique index): the VÖEN lives in two tables (VendorProfile, VendorApplication), older
 * VendorProfile values may contain spaces or dashes (compared as digits), and existing duplicates must never make a
 * migration fail. Writers take a transaction-scoped advisory lock on the VÖEN first, so two concurrent writes of the
 * same number are serialised and the second one sees the first.
 */
import type { Prisma } from "@prisma/client";

export const VOEN_IN_USE_MESSAGE = "Bu VÖEN artıq başqa satıcı hesabında və ya açıq satıcı müraciətində istifadə olunur. Səhv olduğunu düşünürsünüzsə, dəstək xidməti ilə əlaqə saxlayın.";

export type DuplicateVoenMatches = {
  profiles: { vendorProfileId: string; displayName: string; email: string; role: string }[];
  applications: { applicationId: string; displayName: string; email: string }[];
};

type Db = Pick<Prisma.TransactionClient, "$queryRaw" | "vendorApplication">;

/** Serialises writers of the same VÖEN until the end of the current transaction. */
export async function lockVoen(tx: Pick<Prisma.TransactionClient, "$queryRaw">, voenDigits: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS "locked" FROM (SELECT pg_advisory_xact_lock(hashtext(${`bagati:voen:${voenDigits}`}))) AS "lock"`;
}

/**
 * Other sellers and other users' open applications with the same VÖEN digits. The given user and application are
 * excluded (pass applicationId "" when there is none yet).
 */
export async function findDuplicateVoen(db: Db, input: { applicationId: string; userId: string; voenNormalized: string | null }): Promise<DuplicateVoenMatches> {
  if (!input.voenNormalized) return { profiles: [], applications: [] };
  const profiles = await db.$queryRaw<{ vendorProfileId: string; displayName: string; email: string; role: string }[]>`
    SELECT p."id" AS "vendorProfileId", p."displayName", u."email", u."role"::text AS "role"
    FROM "VendorProfile" p JOIN "User" u ON u."id" = p."userId"
    WHERE p."userId" <> ${input.userId}
      AND p."voen" IS NOT NULL
      AND regexp_replace(p."voen", '[^0-9]', '', 'g') = ${input.voenNormalized}
    ORDER BY p."displayName"
    LIMIT 20`;
  const applications = await db.vendorApplication.findMany({
    where: { voenNormalized: input.voenNormalized, status: "PENDING", id: { not: input.applicationId }, userId: { not: input.userId } },
    select: { id: true, displayName: true, user: { select: { email: true } } },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  return {
    profiles,
    applications: applications.map((row) => ({ applicationId: row.id, displayName: row.displayName, email: row.user.email })),
  };
}

export const hasDuplicateVoen = (matches: DuplicateVoenMatches) => matches.profiles.length + matches.applications.length > 0;

/** Lock, then check. True when the VÖEN is free for this user. Call inside the transaction that writes it. */
export async function claimVoenForUser(tx: Db, input: { voenDigits: string; userId: string; applicationId?: string }): Promise<boolean> {
  await lockVoen(tx, input.voenDigits);
  const matches = await findDuplicateVoen(tx, { applicationId: input.applicationId ?? "", userId: input.userId, voenNormalized: input.voenDigits });
  return !hasDuplicateVoen(matches);
}

/** Thrown inside a transaction to roll it back when the VÖEN belongs to another seller. */
export class VoenInUseError extends Error {
  constructor() { super("VOEN_IN_USE"); this.name = "VoenInUseError"; }
}
