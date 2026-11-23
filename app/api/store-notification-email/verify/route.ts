import { NextRequest, NextResponse } from "next/server";
import { consumeAuthProcessRateLimit } from "@/lib/auth-rate-limit";
import { trustedCloudflareClientIp } from "@/lib/trusted-proxy";
import { prisma } from "@/lib/prisma";
import { readJsonBodyLimited } from "@/lib/request-json";
import { verifyNotificationEmailToken } from "@/lib/store-notification-email";

/**
 * Uses a store notification-email link (SELLER-ALERTS, part B). No login: the 256-bit random token proves control of
 * the inbox (the extra address may belong to someone without a BAGATI account). Single use, 24 hours, and only while
 * the store still has the address the link was sent to. The token comes in the body (the page reads it from the URL
 * fragment), never in the URL, so it does not reach server logs. Answers only { ok } (nothing about the store).
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // SEC-FIX-2 L8: guest route, one DB lookup per call. In-process only (no DB write per call): 30 / minute per trusted
  // client IP and 600 / minute for the process. Same { ok } answer as a failed link, so nothing new is shown.
  const clientIp = trustedCloudflareClientIp(request.headers);
  if ((clientIp && !consumeAuthProcessRateLimit(`notification-email-verify:ip:${clientIp}`, 30, 60_000))
    || !consumeAuthProcessRateLimit("notification-email-verify:process", 600, 60_000)) {
    return NextResponse.json({ ok: false }, { status: 429, headers: { "Cache-Control": "no-store" } });
  }
  const body = await readJsonBodyLimited(request, 1024);
  const token = body.ok ? (body.value as { token?: unknown } | null)?.token : null;
  const ok = typeof token === "string" ? await verifyNotificationEmailToken(prisma, token).catch(() => false) : false;
  return NextResponse.json({ ok }, { status: ok ? 200 : 400, headers: { "Cache-Control": "no-store" } });
}
