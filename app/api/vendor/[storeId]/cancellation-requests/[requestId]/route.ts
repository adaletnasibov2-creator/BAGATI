import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireStoreAccess } from "@/lib/auth";
import { csrfRejection } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { CANCELLATION_RESPONSE_MAX } from "@/lib/order-cancellation";
import { decideStoreOrderCancellation } from "@/lib/order-cancellation-service";
import { cancellationErrorResponse } from "@/lib/order-cancellation-http";

export const dynamic = "force-dynamic";
const schema = z.object({ decision: z.enum(["APPROVE", "REJECT"]), response: z.string().trim().max(CANCELLATION_RESPONSE_MAX).nullable().optional() }).strict();

/** The store approves (store cancel, stock restored once, payment untouched) or rejects (reason required) a request. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ storeId: string; requestId: string }> }) {
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const { storeId, requestId } = await params;
  const access = await requireStoreAccess(storeId);
  if (!access || access.user.role !== "VENDOR") return NextResponse.json({ error: "Mağazaya giriş icazəsi yoxdur" }, { status: 403 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Qərarı yoxlayın" }, { status: 422 });
  if (parsed.data.decision === "REJECT" && !parsed.data.response?.trim()) return NextResponse.json({ error: "Rədd etmə səbəbini müştəri üçün yazın" }, { status: 422 });
  try {
    const item = await decideStoreOrderCancellation(prisma, { storeId, requestId, actorUserId: access.user.id, decision: parsed.data.decision, response: parsed.data.response ?? null });
    return NextResponse.json({ item });
  } catch (error) {
    return cancellationErrorResponse(error, "vendor_cancellation_decision");
  }
}
