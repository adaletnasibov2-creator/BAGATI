import type { Role } from "@prisma/client";
import { loginPortalForRole, type LoginPortal } from "@/lib/login-portal";
import { findUserIdsByNormalizedEmail } from "@/lib/login-user-lookup";
import { prisma } from "@/lib/prisma";

export type ExistingAccountIdentity =
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "one"; id: string; role: Role; isActive: boolean };

/**
 * Case-insensitive account lookup through the unique index on lower(btrim(email)) (SCALE-FIX-3, A8 follow-up; it was
 * an ILIKE scan). At most two ids are read so the "ambiguous" answer stays exactly as before; with the unique index in
 * place it cannot happen any more. A row deleted between the two reads counts as "none".
 */
export async function existingAccountIdentity(email: string): Promise<ExistingAccountIdentity> {
  const ids = await findUserIdsByNormalizedEmail(prisma, email, 2);
  if (ids.length === 0) return { kind: "none" };
  if (ids.length > 1) return { kind: "ambiguous" };
  const match = await prisma.user.findUnique({ where: { id: ids[0] }, select: { id: true, role: true, isActive: true } });
  if (!match) return { kind: "none" };
  return { kind: "one", id: match.id, role: match.role, isActive: match.isActive };
}

export async function existingAccountPortal(email: string): Promise<LoginPortal | "ambiguous" | null> {
  const identity = await existingAccountIdentity(email);
  if (identity.kind === "none") return null;
  if (identity.kind === "ambiguous") return "ambiguous";
  return loginPortalForRole(identity.role);
}
