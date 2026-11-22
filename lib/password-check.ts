/**
 * Current-password checks for signed-in users (SEC-FIX-1 L3 and M1): the attempt is counted BEFORE bcrypt runs, so a
 * stolen session cannot be used to guess the account password without limit. Pure: the caller passes the rate-limit
 * and compare steps, so this has no database or bcrypt import of its own.
 */
export type PasswordCheckResult = "ok" | "invalid" | "rate-limited";

export async function checkCurrentPassword(steps: { consumeAttempt: () => Promise<boolean>; compare: () => Promise<boolean> }): Promise<PasswordCheckResult> {
  if (!(await steps.consumeAttempt())) return "rate-limited";
  return (await steps.compare()) ? "ok" : "invalid";
}
