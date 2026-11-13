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
