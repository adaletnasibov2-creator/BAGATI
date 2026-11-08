import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { reconcileOwnedOrder } from "@/lib/payments/epoint-checkout";
import { paymentStatusLabel } from "@/lib/order-status";

const schema = z.object({ orderId: z.string().min(1).max(80) });

export async function POST(request: NextRequest) {
  const user = await requireRole("CUSTOMER");
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Sifariş identifikatoru yanlışdır" }, { status: 400 });
  const result = await reconcileOwnedOrder(user.id, parsed.data.orderId);
  if (!result.ok) return NextResponse.json({ error: "Ödəniş yoxlanılmadı", code: result.code }, { status: result.code === "ORDER_NOT_FOUND" ? 404 : 422, headers: { "Cache-Control": "no-store" } });
  const message = result.status === "PENDING" ? "Ödəniş tamamlanmayıb" : paymentStatusLabel(result.status);
  return NextResponse.json({ status: result.status, message }, { headers: { "Cache-Control": "no-store" } });
}
