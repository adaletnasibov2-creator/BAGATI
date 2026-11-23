import { NextRequest, NextResponse } from "next/server";
import { EPOINT_RECONCILE_IP_RATE_LIMIT, EPOINT_RECONCILE_RATE_LIMIT, withinFormRateLimits } from "@/lib/form-rate-limit";
import { rateLimitedResponse } from "@/lib/rate-limit-response";
import { trustedCloudflareClientIp } from "@/lib/trusted-proxy";
import { bodyTooLargeResponse, JSON_BODY_LIMITS, readJsonCapped } from "@/lib/json-body";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { reconcileOwnedOrder } from "@/lib/payments/epoint-checkout";
import { paymentStatusLabel } from "@/lib/order-status";

const schema = z.object({ orderId: z.string().min(1).max(80) });

export async function POST(request: NextRequest) {
  const user = await requireRole("CUSTOMER");
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  let raw: unknown;
  try { raw = await readJsonCapped(request, JSON_BODY_LIMITS.small); } catch (error) { return bodyTooLargeResponse(error) ?? NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Sifariş identifikatoru yanlışdır" }, { status: 400 });
  // SEC-FIX-2 L8: a PENDING payment makes an outbound call to Epoint; 20 per 10 min per account and 60 per trusted
  // client IP (DB-backed). The return page shows `message`, which is the existing rate-limit text here.
  const clientIp = trustedCloudflareClientIp(request.headers);
  const allowed = await withinFormRateLimits([
    { scope: "epoint-reconcile", identity: `user:${user.id}`, ...EPOINT_RECONCILE_RATE_LIMIT },
    ...(clientIp ? [{ scope: "epoint-reconcile" as const, identity: `ip:${clientIp}`, ...EPOINT_RECONCILE_IP_RATE_LIMIT }] : []),
  ], "epoint_reconcile_rate_limit");
  if (!allowed) return rateLimitedResponse(10 * 60);
  const result = await reconcileOwnedOrder(user.id, parsed.data.orderId);
  if (!result.ok) return NextResponse.json({ error: "Ödəniş yoxlanılmadı", code: result.code }, { status: result.code === "ORDER_NOT_FOUND" ? 404 : 422, headers: { "Cache-Control": "no-store" } });
  const message = result.status === "PENDING" ? "Ödəniş tamamlanmayıb" : paymentStatusLabel(result.status);
  return NextResponse.json({ status: result.status, message }, { headers: { "Cache-Control": "no-store" } });
}
