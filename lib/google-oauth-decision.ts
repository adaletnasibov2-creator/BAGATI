import type { Role } from "@prisma/client";
import type { ExistingAccountIdentity } from "@/lib/existing-account";
import type { GoogleOAuthIntent } from "@/lib/google-oauth";
import { loginPortalForRole, type LoginPortal } from "@/lib/login-portal";

/** Result codes the callback may put in `?oauth=` for a sign-in (not link) attempt. */
export type GoogleSignInResult = "account-exists" | "wrong-role" | "account-inactive" | "seller-not-found";

export type GoogleSignInDecision =
  /** The Google identity is already linked to an active account of the page's role. */
  | { kind: "session"; userId: string }
  /** Same-role password account with this email: confirm the password before linking. */
  | { kind: "link"; userId: string; role: "CUSTOMER" | "VENDOR" }
  /** No account at all on the customer page: create a CUSTOMER account. */
  | { kind: "create-customer" }
  | { kind: "redirect"; result: GoogleSignInResult; portal?: LoginPortal };

type LinkedUser = { id: string; role: Role; isActive: boolean } | null;

export function intentRole(intent: GoogleOAuthIntent): "CUSTOMER" | "VENDOR" {
  return intent === "vendor" ? "VENDOR" : "CUSTOMER";
}

/**
 * Decides what a Google sign-in may do. Pure, so every branch is unit-tested.
 *
 * - The role always comes from the server-signed state intent, never from the browser.
 * - Google only ever creates CUSTOMER accounts, and only from the customer page (intent=customer).
 *   The seller page never creates an account; becoming a seller goes through /vendor/apply.
 * - ADMIN accounts are never signed in or linked through Google.
 * - A different-role account is never offered a password prompt from the wrong page; the user is
 *   pointed to the right portal instead.
 */
export function decideGoogleSignIn(input: {
  intent: GoogleOAuthIntent;
  linkedUser: LinkedUser;
  existing: ExistingAccountIdentity;
}): GoogleSignInDecision {
  const role = intentRole(input.intent);
  const { linkedUser, existing } = input;

  if (linkedUser) {
    if (!linkedUser.isActive) return { kind: "redirect", result: "account-inactive" };
    if (linkedUser.role !== role) return { kind: "redirect", result: "wrong-role", portal: loginPortalForRole(linkedUser.role) };
    return { kind: "session", userId: linkedUser.id };
  }

  if (existing.kind === "ambiguous") return { kind: "redirect", result: "account-exists" };
  if (existing.kind === "one") {
    if (!existing.isActive) return { kind: "redirect", result: "account-inactive" };
    if (existing.role === role && (existing.role === "CUSTOMER" || existing.role === "VENDOR")) {
      return { kind: "link", userId: existing.id, role: existing.role };
    }
    return { kind: "redirect", result: "account-exists", portal: loginPortalForRole(existing.role) };
  }

  if (input.intent === "customer") return { kind: "create-customer" };
  return { kind: "redirect", result: "seller-not-found" };
}
