import type { Role } from "@prisma/client";
import { loginPortalForRole, type LoginPortal } from "@/lib/login-portal";
import { prisma } from "@/lib/prisma";

export type ExistingAccountIdentity =
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "one"; id: string; role: Role; isActive: boolean };

export async function existingAccountIdentity(email: string): Promise<ExistingAccountIdentity> {
  const matches = await prisma.user.findMany({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, role: true, isActive: true },
    take: 2,
  });
  if (matches.length === 0) return { kind: "none" };
  if (matches.length > 1) return { kind: "ambiguous" };
  return { kind: "one", id: matches[0].id, role: matches[0].role, isActive: matches[0].isActive };
}

export async function existingAccountPortal(email: string): Promise<LoginPortal | "ambiguous" | null> {
  const identity = await existingAccountIdentity(email);
  if (identity.kind === "none") return null;
  if (identity.kind === "ambiguous") return "ambiguous";
  return loginPortalForRole(identity.role);
}
