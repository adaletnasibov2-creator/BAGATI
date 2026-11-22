/**
 * SIGNUP-EASY-1 R2: who is signed in right after a correct e-mail verification code, and where they go.
 *
 * Only a CUSTOMER is signed in (the seller flow stays: verify, then /vendor/login). An ADMIN never reaches this: the
 * verification context only carries CUSTOMER or VENDOR (lib/email-verification.ts) and admins need no e-mail code.
 * The destination is sanitized like every other customer return path (same-site path only, never /admin, never a
 * seller page except /vendor/apply).
 */
import { safeOAuthNextPath } from "@/lib/google-oauth";

export type VerifiedSignIn = { signIn: true; redirectTo: string } | { signIn: false; redirectTo: null };

export function verifiedCustomerSignIn(role: string, next: string | null | undefined): VerifiedSignIn {
  if (role !== "CUSTOMER") return { signIn: false, redirectTo: null };
  return { signIn: true, redirectTo: safeOAuthNextPath(next, "customer") };
}
