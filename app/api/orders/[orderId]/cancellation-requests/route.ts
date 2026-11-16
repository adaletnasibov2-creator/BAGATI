import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { csrfRejection } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { CANCELLATION_REASON_MAX } from "@/lib/order-cancellation";
import { requestStoreOrderCancellation } from "@/lib/order-cancellation-service";
import { cancellationErrorResponse } from "@/lib/order-cancellation-http";

export const dynamic = "force-dynamic";
const schema = z.object({ storeOrderId: z.string().min(1).max(80), reason: z.string().trim().min(3).max(CANCELLATION_REASON_MAX) }).strict();

/** Rule 2: the customer asks the store to cancel one store order; the store decides. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const customer = await requireRole("CUSTOMER");
  if (!customer) return NextResponse.json({ error: "Daxil olmaq tələb olunur" }, { status: 401 });
  const { orderId } = await params;
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: `Ləğv səbəbini yazın (3–${CANCELLATION_REASON_MAX} simvol)` }, { status: 422 });
  try {
    const item = await requestStoreOrderCancellation(prisma, { orderId, storeOrderId: parsed.data.storeOrderId, customerId: customer.id, reason: parsed.data.reason });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return cancellationErrorResponse(error, "customer_cancellation_request");
  }
}
