import { revokeComplimentary } from "@/lib/complimentary-entitlements";
import { enqueueEmail } from "@/lib/email-outbox";
import { supportedSubscriptionPlanSlugs } from "@/lib/subscription-plans";

export type ManualSubscriptionInput = {
  storeId: string;
  planId: string;
  status: "PENDING" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELLED" | "EXPIRED";
  periodStart: Date;
  periodEnd: Date;
  reason: string;
  adminId: string;
  now: Date;
};

/**
 * Admin manual subscription save (moved unchanged from the admin route so it can be tested against a
 * real database). Runs inside the caller's Serializable transaction and locks the store row first.
 * Saving an ACTIVE paid subscription revokes the store's free grant in the same transaction.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function saveManualSubscription(tx: any, input: ManualSubscriptionInput) {
  await tx.$queryRaw`SELECT "id" FROM "Store" WHERE "id" = ${input.storeId} FOR UPDATE`;
  const store = await tx.store.findUnique({ where: { id: input.storeId }, select: { id: true, name: true, vendor: { select: { user: { select: { email: true } } } } } });
  if (!store) return { missingStore: true as const };
  const plan = await tx.subscriptionPlan.findFirst({ where: { id: input.planId, isActive: true, slug: { in: [...supportedSubscriptionPlanSlugs] } }, select: { id: true, name: true } });
  if (!plan) return { invalidPlan: true as const };
  const prior = await tx.storeSubscription.findUnique({ where: { storeId: store.id }, include: { plan: { select: { id: true, name: true } } } });
  const values = {
    planId: plan.id, status: input.status, currentPeriodStart: input.periodStart, currentPeriodEnd: input.periodEnd,
    ...(input.status === "ACTIVE" ? { startedAt: prior?.startedAt ?? input.now, cancelledAt: null } : input.status === "CANCELLED" ? { cancelledAt: input.now } : {}),
    accessSource: "ADMIN_MANUAL" as const, grantedByAdminId: input.adminId, grantReason: input.reason,
  };
  const item = prior
    ? await tx.storeSubscription.update({ where: { id: prior.id }, data: values, include: { plan: true, grantedByAdmin: { select: { id: true, email: true } } } })
    : await tx.storeSubscription.create({ data: { storeId: store.id, ...values }, include: { plan: true, grantedByAdmin: { select: { id: true, email: true } } } });
  const auditRow = await tx.auditLog.create({ data: {
    actorId: input.adminId, action: prior ? "ADMIN_SUBSCRIPTION_MANUAL_UPDATE" : "ADMIN_SUBSCRIPTION_MANUAL_CREATE",
    entityType: "StoreSubscription", entityId: item.id,
    metadata: { source: "ADMIN_MANUAL", reason: input.reason,
      previous: prior ? { planId: prior.planId, planName: prior.plan.name, status: prior.status, currentPeriodStart: prior.currentPeriodStart?.toISOString() ?? null, currentPeriodEnd: prior.currentPeriodEnd?.toISOString() ?? null, accessSource: prior.accessSource } : null,
      next: { planId: plan.id, planName: plan.name, status: item.status, currentPeriodStart: input.periodStart.toISOString(), currentPeriodEnd: input.periodEnd.toISOString(), accessSource: "ADMIN_MANUAL" } },
  }, select: { id: true } });
  if (!prior || prior.status !== item.status) await enqueueEmail(tx, { eventKey: `subscription-status:${auditRow.id}`, recipient: store.vendor.user.email, template: "SUBSCRIPTION_STATUS", payload: { storeName: store.name, planName: plan.name, status: item.status } });
  // Switching to paid: an ACTIVE paid subscription ends any free grant in the same transaction (audited).
  const complimentary = item.status === "ACTIVE"
    ? await revokeComplimentary(tx, { storeId: store.id, adminId: input.adminId, reason: `Ödənişli abunəlik aktivləşdirildi: ${input.reason}`.slice(0, 500), source: "PAID_SUBSCRIPTION_ACTIVATED" })
    : { kind: "NONE" as const };
  return { item, complimentaryRevoked: complimentary.kind === "REVOKED" };
}
