import type { Role } from "@prisma/client";
import type { SettingPermission } from "@/lib/settings/registry";

/**
 * Which settings permissions a role holds. Today only ADMIN exists and holds all of them. When RBAC arrives
 * (for example SUPER_ADMIN / FINANCE / CONTENT / SUPPORT), only this map changes: the API already asks for the key's
 * permission, so commission can be limited to finance roles without touching the routes.
 */
const ROLE_PERMISSIONS: Partial<Record<Role, readonly SettingPermission[]>> = {
  ADMIN: ["settings.finance", "settings.content", "settings.limits"],
};

const ALL_PERMISSIONS: readonly SettingPermission[] = ["settings.finance", "settings.content", "settings.limits"];

export function settingPermissionsFor(role: Role): readonly SettingPermission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

/**
 * The permission hook every settings write passes. `permission` is the key's registry permission; for an
 * unknown key it is null and the caller must hold every settings permission (the route answers 404 afterwards),
 * so nobody learns which keys exist without being allowed to edit all of them.
 */
export function requireSettingPermission(user: { role: Role }, permission: SettingPermission | null): boolean {
  const held = settingPermissionsFor(user.role);
  return permission ? held.includes(permission) : ALL_PERMISSIONS.every((item) => held.includes(item));
}
