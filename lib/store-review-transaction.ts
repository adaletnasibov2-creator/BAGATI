import type { Prisma } from "@prisma/client";
import { getStorePublicationBlockers, publishEligibleDraftProducts } from "@/lib/admin-store-product-publishing";
import { grantComplimentary } from "@/lib/complimentary-entitlements";
import { enqueueEmail } from "@/lib/email-outbox";
import { missingSellerLegalFields } from "@/lib/seller-legal-policy";
import { getStoreReviewUpdate, type StoreReviewStatus } from "@/lib/store-review";
import { activeComplimentaryEntitlementSelect, complimentaryFromRows, resolveStoreEntitlements, type EntitlementPlan } from "@/lib/subscription-entitlements";
import { storeReviewNotification } from "@/lib/vendor-notifications";

export type StoreReviewAction = "approve" | "reject" | "suspend" | "reactivate";

export type StoreReviewInput = {
  storeId: string;
  adminId: string;
  action: StoreReviewAction;
  reason?: string;
  /**
   * "Ödənişsiz satış (admin icazəsi)". Null = OFF (the default): approval then needs an ACTIVE,
   * in-period paid subscription exactly as before. Only meaningful with action "approve".
   */
  freeGrant: { tier: EntitlementPlan; endsAt: Date | null; reason: string } | null;
};

/**
 * Admin store review decision. Runs inside the caller's Serializable transaction (moved unchanged
 * from the route so it can be tested against a real database). Locks the store row first.
 */
export async function runStoreReviewTransaction(tx: Prisma.TransactionClient, input: StoreReviewInput) {
  const freeGrant = input.freeGrant;
  const freeGrantEndsAt = freeGrant?.endsAt ?? null;
  await tx.$queryRaw`SELECT "id" FROM "Store" WHERE "id" = ${input.storeId} FOR UPDATE`;
  const store = await tx.store.findUnique({
    where: { id: input.storeId },
    select: {
      id: true, name: true, status: true, isActive: true, legalInfoApproved: true, adminManaged: true,
      city: { select: { isActive: true } },
      subscription: {
        select: {
          status: true, currentPeriodStart: true, currentPeriodEnd: true,
          plan: { select: { slug: true, isActive: true } },
        },
      },
      complimentaryEntitlements: activeComplimentaryEntitlementSelect,
      vendor: {
        select: {
          sellerType: true, legalName: true, voen: true, legalAddress: true,
          user: { select: { id: true, email: true, isActive: true } },
        },
      },
    },
  });
  if (!store) return { kind: "NOT_FOUND" as const };

  const missing = missingSellerLegalFields(store.vendor);
  const decision = getStoreReviewUpdate(
    input.action,
    store.status as StoreReviewStatus,
    missing.length === 0,
    input.reason,
  );
  if (!decision.ok) return { kind: "INVALID_DECISION" as const, error: decision.error, missing };
  const existingGrant = complimentaryFromRows(store.complimentaryEntitlements);
  if (freeGrant && existingGrant) return { kind: "ALREADY_GRANTED" as const };
  // The requested free grant counts for the blockers below; its row is written only after the
  // store update succeeds, so a conflict leaves no grant behind.
  const complimentary = freeGrant ? { tier: freeGrant.tier, endsAt: freeGrantEndsAt } : existingGrant;

  const activating = input.action === "approve" || input.action === "reactivate";
  const candidateState = activating ? {
    status: decision.update.status,
    isActive: true,
    legalInfoApproved: decision.update.legalInfoApproved,
    adminManaged: store.adminManaged,
    vendorActive: store.vendor.user.isActive,
    cityActive: store.city.isActive,
    sellerType: store.vendor.sellerType,
    legalName: store.vendor.legalName,
    voen: store.vendor.voen,
    legalAddress: store.vendor.legalAddress,
    subscriptionStatus: store.subscription?.status ?? null,
    planSlug: store.subscription?.plan.slug ?? null,
    planActive: store.subscription?.plan.isActive ?? false,
    periodStart: store.subscription?.currentPeriodStart ?? null,
    periodEnd: store.subscription?.currentPeriodEnd ?? null,
    complimentary,
  } : null;
  const activationBlockers = candidateState ? getStorePublicationBlockers(candidateState) : [];
  const update = activating
    ? { ...decision.update, isActive: activationBlockers.length === 0 }
    : decision.update;

  const changed = await tx.store.updateMany({
    where: { id: store.id, status: store.status, isActive: store.isActive },
    data: update,
  });
  if (!changed.count) return { kind: "CONFLICT" as const };
  if (freeGrant) {
    const granted = await grantComplimentary(tx, {
      storeId: store.id, adminId: input.adminId, tier: freeGrant.tier, endsAt: freeGrantEndsAt, reason: freeGrant.reason, source: "STORE_APPROVAL",
    });
    if (granted.kind !== "GRANTED") throw new Error("STORE_STATUS_CHANGED");
  }

  const audit = await tx.auditLog.create({
    data: {
      actorId: input.adminId,
      action: decision.auditAction,
      entityType: "Store",
      entityId: store.id,
      metadata: {
        previousStatus: store.status,
        nextStatus: update.status,
        previousIsActive: store.isActive,
        nextIsActive: update.isActive,
        reason: update.reviewNote,
        legalInformationComplete: missing.length === 0,
        activationBlockers,
        complimentaryGrant: freeGrant ? { tier: freeGrant.tier, endsAt: freeGrantEndsAt?.toISOString() ?? null, reason: freeGrant.reason } : null,
      },
    },
    select: { id: true },
  });
  await enqueueEmail(tx, {
    eventKey: `store-review:${audit.id}`,
    recipient: store.vendor.user.email,
    template: "STORE_REVIEW",
    payload: { storeName: store.name, status: update.status, reason: update.reviewNote ?? "" },
  });
  // Seller in-app notification (additive; same transaction as the decision, so it cannot be duplicated or orphaned).
  const sellerNotice = storeReviewNotification(decision.auditAction, store.name, update.reviewNote, update.isActive);
  if (sellerNotice) await tx.notification.create({ data: { userId: store.vendor.user.id, storeId: store.id, ...sellerNotice } });

  const products = activating
    ? await publishEligibleDraftProducts(tx, {
      storeId: store.id,
      actorId: input.adminId,
      plan: candidateState && !activationBlockers.length
        ? resolveStoreEntitlements({
          adminManaged: candidateState.adminManaged,
          storeStatus: candidateState.status,
          storeActive: candidateState.isActive,
          vendorActive: candidateState.vendorActive,
          cityActive: candidateState.cityActive,
          subscriptionStatus: candidateState.subscriptionStatus,
          planSlug: candidateState.planSlug,
          planActive: candidateState.planActive,
          periodStart: candidateState.periodStart,
          periodEnd: candidateState.periodEnd,
          complimentary: candidateState.complimentary,
        }).plan
        : null,
      storeBlockers: activationBlockers,
      reason: input.reason,
    })
    : null;
  const item = await tx.store.findUnique({
    where: { id: store.id },
    select: { id: true, status: true, isActive: true, legalInfoApproved: true, reviewNote: true },
  });
  return { kind: "UPDATED" as const, item, activationBlockers, products, action: decision.auditAction, adminManaged: store.adminManaged, freeGrantTier: freeGrant?.tier ?? null };
}
