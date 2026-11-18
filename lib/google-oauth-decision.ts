import type { Role } from "@prisma/client";
import type { ExistingAccountIdentity } from "@/lib/existing-account";
import type { GoogleOAuthIntent, GoogleOAuthState } from "@/lib/google-oauth";
import { LEGAL_VERSIONS } from "@/lib/legal-versions";
import { loginPortalForRole, type LoginPortal } from "@/lib/login-portal";

/** Result codes the callback may put in `?oauth=` for a sign-in (not link) attempt. */
export type GoogleSignInResult = "account-exists" | "wrong-role" | "account-inactive" | "seller-not-found" | "register-required";

export type GoogleSignInDecision =
  /** The Google identity is already linked to an active account of the page's role. */
  | { kind: "session"; userId: string }
  /** Same-role password account with this email: confirm the password before linking. */
  | { kind: "link"; userId: string; role: "CUSTOMER" | "VENDOR" }
  /** No account at all, customer page, current terms accepted on /register: create a CUSTOMER account. */
  | { kind: "create-customer" }
  | { kind: "redirect"; result: GoogleSignInResult; portal?: LoginPortal };

type LinkedUser = { id: string; role: Role; isActive: boolean } | null;

/**
 * True only when the signed state carries the CURRENT customer-terms version, i.e. the flow started on /register with
 * the checkbox ticked (decision 1a). A /login start has no version; a stale version (the text changed while the user
 * was at Google) does not count either.
 */
export function stateAcceptedCustomerTerms(state: Pick<GoogleOAuthState, "intent" | "mode" | "termsVersion">): boolean {
  return state.intent === "customer" && state.mode === "register" && state.termsVersion === LEGAL_VERSIONS.CUSTOMER_TERMS;
}

export function intentRole(intent: GoogleOAuthIntent): "CUSTOMER" | "VENDOR" {
  return intent === "vendor" ? "VENDOR" : "CUSTOMER";
}

/**
 * Decides what a Google sign-in may do. Pure, so every branch is unit-tested.
 *
 * - The role always comes from the server-signed state intent, never from the browser.
 * - Google only ever creates CUSTOMER accounts, only from the customer page (intent=customer), and only when the
 *   current customer terms were accepted on /register (customerTermsAccepted). Without it an unknown email is sent to
 *   /register ("register-required") and no account is created; existing accounts still sign in normally.
 *   The seller page never creates an account; becoming a seller goes through /vendor/apply.
 * - ADMIN accounts are never signed in or linked through Google.
 * - A different-role account is never offered a password prompt from the wrong page; the user is
 *   pointed to the right portal instead.
 */
export function decideGoogleSignIn(input: {
  intent: GoogleOAuthIntent;
  linkedUser: LinkedUser;
  existing: ExistingAccountIdentity;
  customerTermsAccepted: boolean;
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

  if (input.intent === "customer") return input.customerTermsAccepted ? { kind: "create-customer" } : { kind: "redirect", result: "register-required" };
  return { kind: "redirect", result: "seller-not-found" };
}
