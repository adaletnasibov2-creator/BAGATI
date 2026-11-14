import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * For the middleware's maintenance preview (lib/maintenance-preview.ts): is the caller's own session an admin session?
 * Uses the normal admin check (session revocation, account status, 2FA policy). Says nothing about anyone else.
 */
export async function GET() {
  const admin = await requireRole("ADMIN").catch(() => null);
  return NextResponse.json({ admin: Boolean(admin) }, { headers: { "Cache-Control": "no-store" } });
}
