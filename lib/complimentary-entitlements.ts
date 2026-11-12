import { z } from "zod";
import type { ComplimentaryEntitlementState, EntitlementPlan } from "@/lib/subscription-entitlements";

/**
 * Admin complimentary (free) selling grants for a store. This module is the only writer of
 * StoreComplimentaryEntitlement rows. Rows are never edited: a change of tier or end date revokes
 * the current grant and creates a new one, so the table keeps the full history.
 *
 * Callers must already hold the store row lock (SELECT ... FOR UPDATE) inside their transaction.
 * The partial unique index "one unrevoked grant per store" is the last line of defence.
 */

export const complimentaryTierSchema = z.enum(["BASIC", "PRO"]);
export const complimentaryReasonSchema = z.string().trim().min(8, "Səbəb ən azı 8 simvol olmalıdır.").max(500);
/** YYYY-MM-DD, interpreted as 00:00 UTC of that day (same convention as the manual subscription form). Null = no end date. */
export const complimentaryEndsAtSchema = z.string().date().nullable().optional();

export const COMPLIMENTARY_AUDIT = {
  grant: "ADMIN_COMPLIMENTARY_GRANT",
  change: "ADMIN_COMPLIMENTARY_CHANGE",
  revoke: "ADMIN_COMPLIMENTARY_REVOKE",
} as const;

export type ComplimentarySource = "STORE_APPROVAL" | "ADMIN_PANEL" | "PAID_SUBSCRIPTION_ACTIVATED";

export const COMPLIMENTARY_MESSAGES = {
  endsAtPast: "Bitmə tarixi gələcək tarix olmalıdır.",
  alreadyGranted: "Bu mağazanın artıq qüvvədə olan ödənişsiz satış icazəsi var.",
  none: "Bu mağazanın ödənişsiz satış icazəsi yoxdur.",
} as const;

export function parseComplimentaryEndsAt(value: string | null | undefined, now = new Date()): { ok: true; endsAt: Date | null } | { ok: false; error: string } {
  if (!value) return { ok: true, endsAt: null };
  const endsAt = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(endsAt.getTime())) return { ok: false, error: COMPLIMENTARY_MESSAGES.endsAtPast };
  if (endsAt <= now) return { ok: false, error: COMPLIMENTARY_MESSAGES.endsAtPast };
  return { ok: true, endsAt };
}

type GrantRow = { id: string; tier: EntitlementPlan; endsAt: Date | null; grantReason: string; grantedAt: Date };

function snapshot(row: GrantRow | null) {
  return row ? { id: row.id, tier: row.tier, endsAt: row.endsAt?.toISOString() ?? null, grantReason: row.grantReason, grantedAt: row.grantedAt.toISOString() } : null;
}

export async function findActiveComplimentary(tx: any, storeId: string): Promise<GrantRow | null> {
  return tx.storeComplimentaryEntitlement.findFirst({
    where: { storeId, revokedAt: null },
    orderBy: { grantedAt: "desc" },
    select: { id: true, tier: true, endsAt: true, grantReason: true, grantedAt: true },
  });
}

export function toComplimentaryState(row: { tier: EntitlementPlan; endsAt: Date | null } | null): ComplimentaryEntitlementState {
  return row ? { tier: row.tier, endsAt: row.endsAt } : null;
}

async function audit(tx: any, adminId: string, action: string, entityId: string, metadata: Record<string, unknown>) {
  await tx.auditLog.create({ data: { actorId: adminId, action, entityType: "StoreComplimentaryEntitlement", entityId, metadata }, select: { id: true } });
}

export async function grantComplimentary(tx: any, input: { storeId: string; adminId: string; tier: EntitlementPlan; endsAt: Date | null; reason: string; source: ComplimentarySource }) {
  const existing = await findActiveComplimentary(tx, input.storeId);
  if (existing) return { kind: "ALREADY_GRANTED" as const, existing };
  const row: GrantRow = await tx.storeComplimentaryEntitlement.create({
    data: { storeId: input.storeId, grantedByAdminId: input.adminId, grantReason: input.reason, tier: input.tier, endsAt: input.endsAt },
    select: { id: true, tier: true, endsAt: true, grantReason: true, grantedAt: true },
  });
  await audit(tx, input.adminId, COMPLIMENTARY_AUDIT.grant, row.id, { storeId: input.storeId, source: input.source, reason: input.reason, previous: null, next: snapshot(row) });
  return { kind: "GRANTED" as const, grant: row };
}

export async function revokeComplimentary(tx: any, input: { storeId: string; adminId: string; reason: string; source: ComplimentarySource }) {
  const existing = await findActiveComplimentary(tx, input.storeId);
  if (!existing) return { kind: "NONE" as const };
  const now = new Date();
  const changed = await tx.storeComplimentaryEntitlement.updateMany({
    where: { id: existing.id, revokedAt: null },
    data: { revokedAt: now, revokedByAdminId: input.adminId, revokeReason: input.reason },
  });
  if (changed.count !== 1) throw new Error("COMPLIMENTARY_CONCURRENT_CHANGE");
  await audit(tx, input.adminId, COMPLIMENTARY_AUDIT.revoke, existing.id, { storeId: input.storeId, source: input.source, reason: input.reason, previous: snapshot(existing), next: null, revokedAt: now.toISOString() });
  return { kind: "REVOKED" as const, revoked: existing };
}

/** Changes tier and/or end date by revoking the current grant and creating a new one, in the caller's transaction. */
export async function changeComplimentary(tx: any, input: { storeId: string; adminId: string; tier: EntitlementPlan; endsAt: Date | null; reason: string }) {
  const existing = await findActiveComplimentary(tx, input.storeId);
  if (!existing) return { kind: "NONE" as const };
  const now = new Date();
  const changed = await tx.storeComplimentaryEntitlement.updateMany({
    where: { id: existing.id, revokedAt: null },
    data: { revokedAt: now, revokedByAdminId: input.adminId, revokeReason: `Dəyişiklik: ${input.reason}`.slice(0, 500) },
  });
  if (changed.count !== 1) throw new Error("COMPLIMENTARY_CONCURRENT_CHANGE");
  const row: GrantRow = await tx.storeComplimentaryEntitlement.create({
    data: { storeId: input.storeId, grantedByAdminId: input.adminId, grantReason: input.reason, tier: input.tier, endsAt: input.endsAt },
    select: { id: true, tier: true, endsAt: true, grantReason: true, grantedAt: true },
  });
  await audit(tx, input.adminId, COMPLIMENTARY_AUDIT.change, row.id, { storeId: input.storeId, source: "ADMIN_PANEL", reason: input.reason, previous: snapshot(existing), next: snapshot(row) });
  return { kind: "CHANGED" as const, grant: row, previous: existing };
}

/** Prisma select for the admin grant history panel (newest first). */
export const complimentaryHistorySelect = {
  orderBy: { grantedAt: "desc" },
  take: 10,
  select: { id: true, tier: true, endsAt: true, grantReason: true, grantedAt: true, revokedAt: true, revokeReason: true, grantedByAdmin: { select: { email: true } }, revokedByAdmin: { select: { email: true } } },
} as const;

/** Serializes a history row for the client panel (ISO strings only). */
export function complimentaryGrantView(row: {
  id: string; tier: string; endsAt: Date | null; grantReason: string; grantedAt: Date; revokedAt: Date | null; revokeReason: string | null;
  grantedByAdmin?: { email: string } | null; revokedByAdmin?: { email: string } | null;
}) {
  return {
    id: row.id,
    tier: row.tier === "PRO" ? "PRO" as const : "BASIC" as const,
    endsAt: row.endsAt?.toISOString() ?? null,
    grantReason: row.grantReason,
    grantedAt: row.grantedAt.toISOString(),
    grantedBy: row.grantedByAdmin?.email ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokeReason: row.revokeReason,
    revokedBy: row.revokedByAdmin?.email ?? null,
  };
}
