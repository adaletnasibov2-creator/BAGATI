/**
 * Admin VÖEN verification (table SellerVoenVerification, migration 20261115120000). Server-only.
 *
 * An admin checks the seller's VÖEN by hand on the official taxpayer search (lib/voen.ts VOEN_LOOKUP_URL; the server
 * never calls it) and records "VÖEN təsdiqləndi" with a short note, or withdraws it ("Təsdiqi geri götür"). Only the
 * seller's CURRENT VÖEN can be verified (on the VendorProfile or on an open application): a stale screen is refused.
 * Every decision is in one transaction with an AuditLog row. When the seller changes the VÖEN, their active
 * verifications are revoked automatically (resetVoenVerificationOnChange), so the status goes back to "Yoxlanmayıb".
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { maskVoenDigits, parseVoen } from "@/lib/voen";
import { normalizeVoen } from "@/lib/seller-application";
import { adminLikePattern } from "@/lib/admin-list-where";

export const VOEN_NOTE_MIN = 3;
export const VOEN_NOTE_MAX = 300;
export const VOEN_BULK_MAX = 50;
export const VOEN_RESET_NOTE = "Satıcı VÖEN-i dəyişdi (avtomatik)";
export type VoenStatus = "VERIFIED" | "UNVERIFIED";
export const VOEN_STATUS_LABELS: Record<VoenStatus, string> = { VERIFIED: "Təsdiqlənib", UNVERIFIED: "Yoxlanmayıb" };

export class VoenVerificationError extends Error {
  constructor(readonly code: "INVALID_VOEN" | "INVALID_NOTE" | "STALE" | "ALREADY_VERIFIED" | "NOT_VERIFIED") { super(code); this.name = "VoenVerificationError"; }
}

type Tx = Prisma.TransactionClient;

export function cleanVoenNote(note: unknown): string {
  const value = typeof note === "string" ? note.replace(/\s+/g, " ").trim() : "";
  if (value.length < VOEN_NOTE_MIN || value.length > VOEN_NOTE_MAX) throw new VoenVerificationError("INVALID_NOTE");
  return value;
}

/** The user's current VÖEN digits: the seller profile's, else the open application's (null when none). */
export async function currentVoenOf(tx: Pick<Tx, "vendorProfile" | "vendorApplication">, userId: string): Promise<string | null> {
  const profile = await tx.vendorProfile.findUnique({ where: { userId }, select: { voen: true } });
  if (profile) return normalizeVoen(profile.voen);
  const open = await tx.vendorApplication.findFirst({ where: { userId, status: "PENDING" }, select: { voenNormalized: true } });
  return open?.voenNormalized ?? null;
}

/** Status of exactly this (user, VÖEN) pair: verified only while an unrevoked row exists. */
export async function voenStatusOf(db: Pick<PrismaClient, "sellerVoenVerification"> | Pick<Tx, "sellerVoenVerification">, userId: string, voen: string | null) {
  const digits = normalizeVoen(voen);
  if (!digits) return { status: "UNVERIFIED" as VoenStatus, verifiedAt: null, verifiedBy: null, note: null, revokedAt: null, revokedNote: null };
  const row = await db.sellerVoenVerification.findUnique({
    where: { userId_voen: { userId, voen: digits } },
    select: { verifiedAt: true, verifiedNote: true, revokedAt: true, revokedNote: true, verifiedBy: { select: { email: true } } },
  });
  const verified = Boolean(row && !row.revokedAt);
  return {
    status: (verified ? "VERIFIED" : "UNVERIFIED") as VoenStatus,
    verifiedAt: verified ? row!.verifiedAt : null, verifiedBy: verified ? row!.verifiedBy?.email ?? null : null, note: verified ? row!.verifiedNote : null,
    revokedAt: row?.revokedAt ?? null, revokedNote: row?.revokedNote ?? null,
  };
}

/** For lists and the public badge: the user ids whose given VÖEN is verified and not revoked. */
export async function verifiedVoenUserIds(db: Pick<PrismaClient, "sellerVoenVerification">, pairs: { userId: string; voen: string | null }[]): Promise<Set<string>> {
  const wanted = pairs.map((pair) => ({ userId: pair.userId, voen: normalizeVoen(pair.voen) })).filter((pair): pair is { userId: string; voen: string } => Boolean(pair.voen));
  if (!wanted.length) return new Set();
  const rows = await db.sellerVoenVerification.findMany({
    where: { revokedAt: null, OR: wanted.map((pair) => ({ userId: pair.userId, voen: pair.voen })) },
    select: { userId: true },
  });
  return new Set(rows.map((row) => row.userId));
}

async function lockUser(tx: Tx, userId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  if (!rows.length) throw new VoenVerificationError("STALE");
}

export async function verifyVoen(db: Pick<PrismaClient, "$transaction">, input: { adminId: string; userId: string; voen: string; note: string; now?: Date }) {
  const parsed = parseVoen(input.voen);
  if (!parsed.ok) throw new VoenVerificationError("INVALID_VOEN");
  const note = cleanVoenNote(input.note);
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    await lockUser(tx, input.userId);
    if (await currentVoenOf(tx, input.userId) !== parsed.voen) throw new VoenVerificationError("STALE");
    const existing = await tx.sellerVoenVerification.findUnique({ where: { userId_voen: { userId: input.userId, voen: parsed.voen } }, select: { id: true, revokedAt: true } });
    if (existing && !existing.revokedAt) throw new VoenVerificationError("ALREADY_VERIFIED");
    const data = { verifiedAt: now, verifiedById: input.adminId, verifiedNote: note, revokedAt: null, revokedById: null, revokedNote: null };
    const row = existing
      ? await tx.sellerVoenVerification.update({ where: { id: existing.id }, data, select: { id: true } })
      : await tx.sellerVoenVerification.create({ data: { userId: input.userId, voen: parsed.voen, ...data }, select: { id: true } });
    await tx.auditLog.create({ data: {
      actorId: input.adminId, action: "SELLER_VOEN_VERIFIED", entityType: "User", entityId: input.userId,
      metadata: { verificationId: row.id, voen: maskVoenDigits(parsed.voen), note },
    } });
    return row;
  });
}

export async function revokeVoenVerification(db: Pick<PrismaClient, "$transaction">, input: { adminId: string; userId: string; voen: string; note: string; now?: Date }) {
  const parsed = parseVoen(input.voen);
  if (!parsed.ok) throw new VoenVerificationError("INVALID_VOEN");
  const note = cleanVoenNote(input.note);
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    await lockUser(tx, input.userId);
    const existing = await tx.sellerVoenVerification.findUnique({ where: { userId_voen: { userId: input.userId, voen: parsed.voen } }, select: { id: true, revokedAt: true } });
    if (!existing || existing.revokedAt) throw new VoenVerificationError("NOT_VERIFIED");
    await tx.sellerVoenVerification.update({ where: { id: existing.id }, data: { revokedAt: now, revokedById: input.adminId, revokedNote: note } });
    await tx.auditLog.create({ data: {
      actorId: input.adminId, action: "SELLER_VOEN_VERIFICATION_REVOKED", entityType: "User", entityId: input.userId,
      metadata: { verificationId: existing.id, voen: maskVoenDigits(parsed.voen), note },
    } });
    return existing;
  });
}

/** Inside the transaction that changes a user's VÖEN: active verifications go back to "Yoxlanmayıb". Audited. */
export async function resetVoenVerificationOnChange(tx: Tx, input: { userId: string; actorId: string; now?: Date }) {
  const changed = await tx.sellerVoenVerification.updateMany({
    where: { userId: input.userId, revokedAt: null },
    data: { revokedAt: input.now ?? new Date(), revokedById: input.actorId, revokedNote: VOEN_RESET_NOTE },
  });
  if (changed.count > 0) {
    await tx.auditLog.create({ data: {
      actorId: input.actorId, action: "SELLER_VOEN_VERIFICATION_RESET", entityType: "User", entityId: input.userId,
      metadata: { reason: "VOEN_CHANGED", revoked: changed.count },
    } });
  }
  return changed.count;
}

export type AdminVoenView = {
  userId: string;
  /** Digits of the current VÖEN (null when none). */
  voen: string | null;
  formatValid: boolean;
  kindLabel: string | null;
  status: VoenStatus;
  statusLabel: string;
  verifiedLabel: string | null;
  revokedLabel: string | null;
};

/** Serializable view for AdminVoenPanel; dates are formatted on the server (Baku time). */
export async function adminVoenView(
  db: Pick<PrismaClient, "sellerVoenVerification">,
  userId: string,
  rawVoen: string | null,
  formatDate: (date: Date) => string,
): Promise<AdminVoenView> {
  const digits = normalizeVoen(rawVoen);
  const parsed = parseVoen(digits ?? "");
  const status = await voenStatusOf(db, userId, digits);
  return {
    userId, voen: digits, formatValid: parsed.ok, kindLabel: parsed.ok ? (parsed.kind === "LEGAL_ENTITY" ? "Hüquqi şəxs" : "Fiziki şəxs / fərdi sahibkar") : null,
    status: status.status, statusLabel: VOEN_STATUS_LABELS[status.status],
    verifiedLabel: status.status === "VERIFIED" && status.verifiedAt ? `${formatDate(status.verifiedAt)} · ${status.verifiedBy ?? "silinmiş admin"} · ${status.note}` : null,
    revokedLabel: status.status === "UNVERIFIED" && status.revokedAt ? `Təsdiq geri götürülüb: ${formatDate(status.revokedAt)} · ${status.revokedNote ?? ""}` : null,
  };
}

export const VOEN_LIST_PAGE_SIZE = 50;
export type VoenListFilter = "UNVERIFIED" | "VERIFIED" | "ALL";
export type VoenListRow = {
  userId: string; displayName: string; email: string; voen: string | null; digits: string;
  verified: boolean; duplicate: boolean; stores: number; storeNames: string | null; firstStoreId: string | null;
};

/** Sellers (VendorProfile) for the bulk VÖEN check page: status filter, search by name, e-mail or VÖEN digits. */
export async function listSellersForVoenReview(db: Pick<PrismaClient, "$queryRaw">, input: { filter: VoenListFilter; q: string; page: number }) {
  const P = Prisma;
  const digitsExpr = P.sql`regexp_replace(coalesce(p."voen", ''), '[^0-9]', '', 'g')`;
  const statusWhere = input.filter === "UNVERIFIED" ? P.sql`v."id" IS NULL` : input.filter === "VERIFIED" ? P.sql`v."id" IS NOT NULL` : P.sql`TRUE`;
  const q = input.q.trim().slice(0, 100);
  const searchDigits = q.replace(/\D/g, "");
  const searchWhere = q
    ? P.sql`(p."displayName" ILIKE ${adminLikePattern(q)} OR u."email" ILIKE ${adminLikePattern(q)}${searchDigits.length >= 3 ? P.sql` OR ${digitsExpr} LIKE ${`%${searchDigits}%`}` : P.empty})`
    : P.sql`TRUE`;
  const from = P.sql`
    FROM "VendorProfile" p
    JOIN "User" u ON u."id" = p."userId"
    LEFT JOIN "SellerVoenVerification" v ON v."userId" = p."userId" AND v."voen" = ${digitsExpr} AND v."revokedAt" IS NULL
    WHERE ${statusWhere} AND ${searchWhere}`;
  const offset = (Math.max(1, input.page) - 1) * VOEN_LIST_PAGE_SIZE;
  const rows = await db.$queryRaw<VoenListRow[]>`
    SELECT p."userId", p."displayName", u."email", p."voen", ${digitsExpr} AS "digits", (v."id" IS NOT NULL) AS "verified",
      (${digitsExpr} <> '' AND EXISTS (
        SELECT 1 FROM "VendorProfile" o WHERE o."userId" <> p."userId" AND o."voen" IS NOT NULL
          AND regexp_replace(o."voen", '[^0-9]', '', 'g') = ${digitsExpr})) AS "duplicate",
      (SELECT count(*)::int FROM "Store" s WHERE s."vendorId" = p."id") AS "stores",
      (SELECT string_agg(x."name", ', ') FROM (SELECT s."name" FROM "Store" s WHERE s."vendorId" = p."id" ORDER BY s."createdAt" LIMIT 3) x) AS "storeNames",
      (SELECT s."id" FROM "Store" s WHERE s."vendorId" = p."id" ORDER BY s."createdAt" LIMIT 1) AS "firstStoreId"
    ${from}
    ORDER BY (v."id" IS NOT NULL), p."displayName", p."userId"
    LIMIT ${VOEN_LIST_PAGE_SIZE} OFFSET ${offset}`;
  const [count] = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS "n" ${from}`;
  return { rows, total: count?.n ?? 0 };
}

/**
 * Public "Təsdiqlənmiş satıcı" badge: true only while the seller's CURRENT VÖEN is admin-verified. Fails closed
 * (false) on any error, e.g. before migration 20261115120000 is applied, so the page never breaks or over-claims.
 */
export async function isSellerVoenVerified(db: Pick<PrismaClient, "sellerVoenVerification">, input: { userId: string; voen: string | null }): Promise<boolean> {
  try {
    return (await verifiedVoenUserIds(db, [input])).has(input.userId);
  } catch {
    return false;
  }
}
