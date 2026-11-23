import { NextResponse } from "next/server";

/** The existing rate-limit text (password change, Google link, reset password, admin 2FA, Google sign-in). */
export const RATE_LIMITED_MESSAGE = "Çox sayda cəhd edildi. Bir müddət sonra yenidən yoxlayın.";

/**
 * 429 with the existing text. `message` is the same text too, for clients that show `data.message`
 * (the Epoint return check).
 */
export function rateLimitedResponse(retryAfterSeconds?: number) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (retryAfterSeconds && retryAfterSeconds > 0) headers["Retry-After"] = String(Math.ceil(retryAfterSeconds));
  return NextResponse.json({ error: RATE_LIMITED_MESSAGE, message: RATE_LIMITED_MESSAGE, code: "RATE_LIMITED" }, { status: 429, headers });
}
