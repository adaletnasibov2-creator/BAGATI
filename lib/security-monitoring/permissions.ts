import type { Role } from "@prisma/client";

/** Security Center permissions: view the live panel and incidents, respond to incidents, edit alert rules. */
export type SecurityPermission = "security.view" | "security.respond" | "security.rules";

/**
 * Which Security Center permissions a role holds. Same hook as the settings engine (lib/settings/permissions.ts):
 * today only ADMIN exists and holds all of them; when RBAC arrives only this map changes (for example a SUPPORT role
 * with view + respond but not rules), the routes already ask for the specific permission.
 */
const ROLE_PERMISSIONS: Partial<Record<Role, readonly SecurityPermission[]>> = {
  ADMIN: ["security.view", "security.respond", "security.rules"],
};

export function securityPermissionsFor(role: Role): readonly SecurityPermission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function requireSecurityPermission(user: { role: Role }, permission: SecurityPermission): boolean {
  return securityPermissionsFor(user.role).includes(permission);
}
