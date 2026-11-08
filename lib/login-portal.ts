import type { Role } from "@prisma/client";

export type LoginPortal = "customer" | "vendor" | "admin";

export function isLoginPortal(value: unknown): value is LoginPortal {
  return value === "customer" || value === "vendor" || value === "admin";
}

export function loginPortalPath(portal: string | null | undefined) {
  if (portal === "customer") return "/login";
  if (portal === "vendor") return "/vendor/login";
  if (portal === "admin") return "/admin/login";
  return null;
}

export function loginPortalLinkLabel(portal: LoginPortal) {
  if (portal === "vendor") return "Satıcı girişinə keç";
  if (portal === "admin") return "Admin girişinə keç";
  return "Müştəri girişinə keç";
}

export function loginPortalForRole(role: Role): LoginPortal {
  if (role === "VENDOR") return "vendor";
  if (role === "ADMIN") return "admin";
  return "customer";
}

/** Shown only after the password matches. A missing account or wrong password stays generic. */
export function wrongPortalBody(role: Role) {
  const portal = loginPortalForRole(role);
  const error = portal === "vendor"
    ? "Bu hesab satıcı girişindən açılır."
    : portal === "admin"
      ? "Bu hesab idarəçi girişindən açılır."
      : "Bu hesab müştəri girişindən açılır.";
  return { error, code: "WRONG_PORTAL" as const, portal };
}
