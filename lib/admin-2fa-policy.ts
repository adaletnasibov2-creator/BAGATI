/** Admin 2FA rules: rollout flag, lockout and the step after a correct password. Pure; unit-tested. */
import type { Admin2faKeyStatus } from "@/lib/admin-2fa-crypto";

export const ADMIN_2FA_REQUIRED_ENV = "BAGATI_ADMIN_2FA_REQUIRED";
/** Consecutive wrong codes before the account's second factor is locked. */
export const ADMIN_2FA_MAX_FAILURES = 5;
export const ADMIN_2FA_LOCK_MS = 15 * 60 * 1000;
/** Rate limits on code attempts (in addition to the lockout). */
export const ADMIN_2FA_USER_RATE_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 } as const;
export const ADMIN_2FA_IP_RATE_LIMIT = { limit: 30, windowMs: 15 * 60 * 1000 } as const;
/** Lifetime of the password-step challenge (code entry) and of the forced-enrollment challenge. */
export const ADMIN_2FA_CHALLENGE_SECONDS = 5 * 60;
export const ADMIN_2FA_ENROLL_CHALLENGE_SECONDS = 15 * 60;

export function isAdmin2faRequired(env: Record<string, string | undefined> = process.env): boolean {
  return env[ADMIN_2FA_REQUIRED_ENV]?.trim().toLowerCase() === "true";
}

export type AdminLoginNextStep =
  /** Not enrolled and 2FA optional: create the session now (current behaviour). */
  | "session"
  /** Enrolled: ask for a TOTP or recovery code before any session exists. */
  | "code"
  /** Not enrolled while 2FA is required: enroll before any session exists. */
  | "enroll"
  /** Not enrolled, 2FA required, but enrollment is impossible because the key is not configured. */
  | "blocked-key-missing";

export function adminLoginNextStep(input: { enrolled: boolean; required: boolean; keyStatus: Admin2faKeyStatus }): AdminLoginNextStep {
  if (input.enrolled) return "code";
  if (!input.required) return "session";
  return input.keyStatus === "configured" ? "enroll" : "blocked-key-missing";
}

export type LockState = { failedAttempts: number; lockedUntil: Date | null };

export function isSecondFactorLocked(state: LockState, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}

/** State after one more wrong code. The counter restarts after a lock has expired. */
export function afterFailedSecondFactor(state: LockState, now: Date): LockState & { lockedNow: boolean } {
  const lockExpired = state.lockedUntil !== null && state.lockedUntil.getTime() <= now.getTime();
  const failedAttempts = (lockExpired ? 0 : state.failedAttempts) + 1;
  if (failedAttempts >= ADMIN_2FA_MAX_FAILURES) {
    return { failedAttempts, lockedUntil: new Date(now.getTime() + ADMIN_2FA_LOCK_MS), lockedNow: true };
  }
  return { failedAttempts, lockedUntil: lockExpired ? null : state.lockedUntil, lockedNow: false };
}

/** An admin page or API is reachable only when 2FA is not required or the admin is enrolled. */
export function adminMayUseSession(input: { required: boolean; enrolled: boolean }): boolean {
  return !input.required || input.enrolled;
}
