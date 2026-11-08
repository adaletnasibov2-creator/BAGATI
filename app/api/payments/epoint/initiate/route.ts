import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { startEpointCheckout } from "@/lib/payments/epoint-checkout";
import { consumePaymentRateLimit } from "@/lib/payments/epoint-rate-limit";

const schema = z.object({ orderId: z.string().min(1).max(80) });

export async function POST(request: NextRequest) {
  const user = await requireRole("CUSTOMER");
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!consumePaymentRateLimit(`initiate:${user.id}`, 10, 60_000)) return NextResponse.json({ error: "Çox sayda cəhd", code: "RATE_LIMITED" }, { status: 429, headers: { "Cache-Control": "no-store" } });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Sifariş identifikatoru yanlışdır" }, { status: 400 });
  const result = await startEpointCheckout(user.id, parsed.data.orderId);
  if (!result.ok) {
    const status = result.code === "ORDER_NOT_FOUND" ? 404 : result.code === "EPOINT_NOT_CONFIGURED" ? 503 : result.code === "ALREADY_PAID" || result.code === "ALREADY_STARTED" ? 409 : 422;
    return NextResponse.json({ error: "Ödəniş başladılmadı", code: result.code }, { status, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ redirectUrl: result.redirectUrl }, { headers: { "Cache-Control": "no-store" } });
}
