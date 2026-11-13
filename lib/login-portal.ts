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

/**
 * Where a visitor who is not a seller goes when they open the seller area.
 * A signed-in CUSTOMER goes to /vendor/apply (apply, or see the application status); everyone else to the seller login.
 */
export function vendorAreaRedirectPath(role: Role | null | undefined): "/vendor/apply" | "/vendor/login" {
  return role === "CUSTOMER" ? "/vendor/apply" : "/vendor/login";
}

/** Customer sign-in that returns to the seller application page. */
export const SELLER_APPLY_LOGIN_PATH = "/login?next=%2Fvendor%2Fapply";

/**
 * Seller login with a CUSTOMER account (shown only after the password matches). Customers become sellers
 * through an application, so point them there instead of only to the customer login.
 * Says nothing about whether an application exists.
 */
export function vendorLoginCustomerBody() {
  return {
    error: "Bu hesab müştəri hesabıdır, satıcı hesabı deyil. Satıcı olmaq və ya satıcı müraciətinizin statusunu görmək üçün müştəri kimi daxil olub “Satıcı müraciəti” səhifəsinə keçin.",
    code: "WRONG_PORTAL" as const,
    portal: "customer" as const,
    applyPath: SELLER_APPLY_LOGIN_PATH,
  };
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
