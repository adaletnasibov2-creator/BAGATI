/**
 * Database side of seller applications. Every function takes the Prisma client (or a transaction) so it can be
 * exercised against the isolated verify database. Routes stay thin: CSRF, auth, body, then one call here.
 */
import type { Prisma, SellerType } from "@prisma/client";
import { normalizeVoen } from "@/lib/seller-application";

/**
 * Records a seller created directly by an admin as an APPROVED application with source ADMIN.
 * Runs inside the caller's transaction so the user, the profile and this row commit together.
 * ADMIN rows are exempt from the 10-digit VÖEN rule (database CHECK applies to SELF rows only).
 */
export async function recordAdminCreatedSeller(tx: Prisma.TransactionClient, input: {
  userId: string;
  vendorProfileId: string;
  adminId: string;
  displayName: string;
  phone: string | null;
  sellerType: SellerType;
  legalName: string;
  voen: string;
  legalAddress: string | null;
  storeName: string;
  now: Date;
}) {
  return tx.vendorApplication.create({
    data: {
      userId: input.userId,
      status: "APPROVED",
      source: "ADMIN",
      displayName: input.displayName,
      phone: input.phone,
      sellerType: input.sellerType,
      legalName: input.legalName,
      voen: input.voen,
      voenNormalized: normalizeVoen(input.voen),
      legalAddress: input.legalAddress,
      plannedStoreName: input.storeName,
      vendorProfileId: input.vendorProfileId,
      reviewedById: input.adminId,
      reviewedAt: input.now,
    },
    select: { id: true },
  });
}

export type SellerApplicationErrorCode =
  | "NOT_FOUND"
  | "NOT_PENDING"
  | "ACCOUNT_CHANGED"
  | "DUPLICATE_VOEN_UNCONFIRMED"
  | "OPEN"
  | "APPROVED"
  | "WAIT"
  | "LIMIT";

export class SellerApplicationError extends Error {
  constructor(public readonly code: SellerApplicationErrorCode, public readonly detail: Record<string, unknown> = {}) {
    super(code);
    this.name = "SellerApplicationError";
  }
}

export type DuplicateVoenMatches = {
  profiles: { vendorProfileId: string; displayName: string; email: string; role: string }[];
  applications: { applicationId: string; displayName: string; email: string }[];
};

/**
 * Other sellers and other open applications with the same VÖEN digits. The applicant's own profile and
 * the application itself are excluded. A match is a warning for the admin, never a silent block or pass.
 */
export async function findDuplicateVoen(db: Prisma.TransactionClient, input: { applicationId: string; userId: string; voenNormalized: string | null }): Promise<DuplicateVoenMatches> {
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

export type TransactionRunner = { $transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> };
export type OutboxEnqueue = (tx: Prisma.TransactionClient, email: { eventKey: string; recipient: string; template: "SELLER_APPLICATION_SUBMITTED" | "SELLER_APPLICATION_APPROVED" | "SELLER_APPLICATION_REJECTED"; payload: Record<string, string> }) => Promise<void>;

/** Locks the application row for the rest of the transaction; concurrent reviews and withdrawals wait here. */
async function lockApplication(tx: Prisma.TransactionClient, applicationId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "VendorApplication" WHERE "id" = ${applicationId} FOR UPDATE`;
  if (!rows.length) throw new SellerApplicationError("NOT_FOUND");
}

/**
 * Admin approval, all in ONE transaction: role CUSTOMER -> VENDOR, VendorProfile from the application,
 * APPROVED with reviewer, audit entry and the queued e-mail. Any failure rolls everything back.
 * The applicant's existing sessions keep working: the role is read from the database on every request.
 */
export async function approveSellerApplication(db: TransactionRunner, input: {
  applicationId: string;
  adminId: string;
  confirmDuplicateVoen: boolean;
  adminNote: string | null;
  enqueue: OutboxEnqueue;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    await lockApplication(tx, input.applicationId);
    const application = await tx.vendorApplication.findUniqueOrThrow({
      where: { id: input.applicationId },
      include: { user: { select: { id: true, email: true, role: true, isActive: true, emailVerifiedAt: true } } },
    });
    if (application.status !== "PENDING") throw new SellerApplicationError("NOT_PENDING", { status: application.status });
    const { user } = application;
    if (user.role !== "CUSTOMER" || !user.isActive || !user.emailVerifiedAt) throw new SellerApplicationError("ACCOUNT_CHANGED");

    const duplicates = await findDuplicateVoen(tx, { applicationId: application.id, userId: user.id, voenNormalized: application.voenNormalized });
    const duplicate = hasDuplicateVoen(duplicates);
    if (duplicate && !input.confirmDuplicateVoen) {
      throw new SellerApplicationError("DUPLICATE_VOEN_UNCONFIRMED", { profiles: duplicates.profiles.length, applications: duplicates.applications.length });
    }

    // The only self-service path to the VENDOR role. Guarded by the current role so a stale request cannot re-promote.
    const promoted = await tx.user.updateMany({ where: { id: user.id, role: "CUSTOMER", isActive: true }, data: { role: "VENDOR" } });
    if (promoted.count !== 1) throw new SellerApplicationError("ACCOUNT_CHANGED");

    const profileData = {
      displayName: application.displayName,
      phone: application.phone,
      sellerType: application.sellerType,
      legalName: application.legalName,
      voen: application.voen,
      legalAddress: application.legalAddress,
    };
    const existing = await tx.vendorProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
    const profile = existing
      ? await tx.vendorProfile.update({ where: { id: existing.id }, data: profileData, select: { id: true } })
      : await tx.vendorProfile.create({ data: { userId: user.id, ...profileData }, select: { id: true } });
    // Same rule as a seller editing legal details: stores of an older profile need a new legal review.
    if (existing) await tx.store.updateMany({ where: { vendorId: existing.id }, data: { legalInfoApproved: false } });

    await tx.vendorApplication.update({
      where: { id: application.id },
      data: {
        status: "APPROVED",
        openUserId: null,
        reviewedById: input.adminId,
        reviewedAt: now,
        vendorProfileId: profile.id,
        adminNote: input.adminNote,
        duplicateVoenConfirmed: duplicate,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.adminId,
        action: "SELLER_APPLICATION_APPROVED",
        entityType: "VendorApplication",
        entityId: application.id,
        // Ids and flags only: no VÖEN, phone, address or notes in audit metadata.
        metadata: {
          applicantUserId: user.id,
          vendorProfileId: profile.id,
          profileExisted: Boolean(existing),
          sellerType: application.sellerType,
          hasDuplicateVoen: duplicate,
          duplicateVoenConfirmed: duplicate,
        },
      },
    });
    await input.enqueue(tx, {
      eventKey: `seller-application-approved:${application.id}`,
      recipient: user.email,
      template: "SELLER_APPLICATION_APPROVED",
      payload: { displayName: application.displayName },
    });
    return { applicationId: application.id, userId: user.id, vendorProfileId: profile.id, duplicateVoenConfirmed: duplicate };
  });
}

/** Admin rejection: REJECTED with a reason the applicant sees, audit entry, queued e-mail. The role stays CUSTOMER. */
export async function rejectSellerApplication(db: TransactionRunner, input: {
  applicationId: string;
  adminId: string;
  reason: string;
  adminNote: string | null;
  enqueue: OutboxEnqueue;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    await lockApplication(tx, input.applicationId);
    const application = await tx.vendorApplication.findUniqueOrThrow({
      where: { id: input.applicationId },
      select: { id: true, status: true, userId: true, displayName: true, user: { select: { email: true } } },
    });
    if (application.status !== "PENDING") throw new SellerApplicationError("NOT_PENDING", { status: application.status });
    await tx.vendorApplication.update({
      where: { id: application.id },
      data: { status: "REJECTED", openUserId: null, rejectionReason: input.reason, adminNote: input.adminNote, reviewedById: input.adminId, reviewedAt: now },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.adminId,
        action: "SELLER_APPLICATION_REJECTED",
        entityType: "VendorApplication",
        entityId: application.id,
        metadata: { applicantUserId: application.userId, reasonLength: input.reason.length },
      },
    });
    await input.enqueue(tx, {
      eventKey: `seller-application-rejected:${application.id}`,
      recipient: application.user.email,
      template: "SELLER_APPLICATION_REJECTED",
      payload: { displayName: application.displayName, reason: input.reason },
    });
    return { applicationId: application.id, userId: application.userId };
  });
}

export const SELLER_APPLICATION_PAGE_SIZE = 25;

export type SellerApplicationListFilters = { status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN" | "ALL"; q: string };

/** Admin queue: newest first within the chosen status; search by name, legal name, VÖEN digits or e-mail. */
export async function listSellerApplications(db: Prisma.TransactionClient, filters: SellerApplicationListFilters, page: number) {
  const q = filters.q.trim().slice(0, 100);
  const digits = normalizeVoen(q);
  const where: Prisma.VendorApplicationWhereInput = {
    ...(filters.status === "ALL" ? {} : { status: filters.status }),
    ...(q ? {
      OR: [
        { displayName: { contains: q, mode: "insensitive" } },
        { legalName: { contains: q, mode: "insensitive" } },
        { user: { email: { contains: q, mode: "insensitive" } } },
        ...(digits && digits.length >= 3 ? [{ voenNormalized: { contains: digits } }] : []),
      ],
    } : {}),
  };
  const [rows, total] = await Promise.all([
    db.vendorApplication.findMany({
      where,
      orderBy: filters.status === "PENDING" ? { createdAt: "asc" } : { createdAt: "desc" },
      skip: (page - 1) * SELLER_APPLICATION_PAGE_SIZE,
      take: SELLER_APPLICATION_PAGE_SIZE,
      select: {
        id: true, status: true, source: true, displayName: true, sellerType: true, voenNormalized: true, createdAt: true, reviewedAt: true, userId: true,
        user: { select: { email: true } },
      },
    }),
    db.vendorApplication.count({ where }),
  ]);
  const duplicates = await duplicateVoenFlags(db, rows);
  return { rows: rows.map((row) => ({ ...row, duplicateVoen: duplicates.has(row.id) })), total };
}

/** Ids of the given applications whose VÖEN also appears on another seller profile or another open application. */
export async function duplicateVoenFlags(db: Prisma.TransactionClient, rows: { id: string; userId: string; voenNormalized: string | null }[]) {
  const voens = [...new Set(rows.map((row) => row.voenNormalized).filter((value): value is string => Boolean(value)))];
  const flagged = new Set<string>();
  if (!voens.length) return flagged;
  const profiles = await db.$queryRaw<{ voen: string; userId: string }[]>`
    SELECT regexp_replace(p."voen", '[^0-9]', '', 'g') AS "voen", p."userId"
    FROM "VendorProfile" p
    WHERE p."voen" IS NOT NULL AND regexp_replace(p."voen", '[^0-9]', '', 'g') = ANY(${voens}::text[])`;
  const open = await db.vendorApplication.findMany({ where: { status: "PENDING", voenNormalized: { in: voens } }, select: { id: true, userId: true, voenNormalized: true } });
  for (const row of rows) {
    if (!row.voenNormalized) continue;
    const other = profiles.some((p) => p.voen === row.voenNormalized && p.userId !== row.userId)
      || open.some((a) => a.voenNormalized === row.voenNormalized && a.id !== row.id && a.userId !== row.userId);
    if (other) flagged.add(row.id);
  }
  return flagged;
}
