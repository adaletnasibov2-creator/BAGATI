import { NextRequest, NextResponse } from "next/server";
import { SUPPORT_IP_RATE_LIMIT, SUPPORT_RATE_LIMIT, withinFormRateLimits } from "@/lib/form-rate-limit";
import { rateLimitedResponse } from "@/lib/rate-limit-response";
import { trustedCloudflareClientIp } from "@/lib/trusted-proxy";
import { bodyTooLargeResponse, JSON_BODY_LIMITS, readJsonCapped } from "@/lib/json-body";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({ subject: z.string().trim().min(4).max(160), message: z.string().trim().min(10).max(5000) });
export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Dəstək müraciəti üçün giriş edin" }, { status: 401 });
  let body: unknown;
  try { body = await readJsonCapped(request, JSON_BODY_LIMITS.medium); } catch (error) { return bodyTooLargeResponse(error) ?? NextResponse.json({ error: "Yanlış JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Müraciət məlumatlarını yoxlayın", details: parsed.error.flatten() }, { status: 400 });
  // SEC-FIX-2 L8: each ticket is a stored row; 5 per 15 min per account and 20 per trusted client IP (DB-backed).
  const clientIp = trustedCloudflareClientIp(request.headers);
  const allowed = await withinFormRateLimits([
    { scope: "support", identity: `user:${user.id}`, ...SUPPORT_RATE_LIMIT },
    ...(clientIp ? [{ scope: "support" as const, identity: `ip:${clientIp}`, ...SUPPORT_IP_RATE_LIMIT }] : []),
  ], "support_rate_limit");
  if (!allowed) return rateLimitedResponse(15 * 60);
  const ticket = await prisma.supportTicket.create({ data: { userId: user.id, ...parsed.data } });
  return NextResponse.json({ ticket: { id: ticket.id, subject: ticket.subject, status: ticket.status, createdAt: ticket.createdAt } }, { status: 201 });
}
