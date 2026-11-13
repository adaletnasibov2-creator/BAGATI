import { NextRequest, NextResponse } from "next/server";
import { csrfRejection } from "@/lib/csrf";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readJsonBodyLimited } from "@/lib/request-json";
import { enqueueEmail } from "@/lib/email-outbox";
import { SELLER_APPLICATION_MESSAGES, sellerApplicationReviewSchema } from "@/lib/seller-application";
import { approveSellerApplication, rejectSellerApplication, SellerApplicationError } from "@/lib/seller-application-service";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers });

/** ADMIN approves or rejects one PENDING seller application. Same-origin only; every decision is audited. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const admin = await requireRole("ADMIN");
  if (!admin) return json({ error: "İcazə yoxdur" }, 403);
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return json({ error: SELLER_APPLICATION_MESSAGES.notFound }, 404);
  const body = await readJsonBodyLimited(request, 4 * 1024);
  if (!body.ok) return json({ error: "Sorğu məlumatı yanlışdır" }, body.status);
  const parsed = sellerApplicationReviewSchema.safeParse(body.value);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message || "Sorğu məlumatı yanlışdır" }, 422);

  try {
    if (parsed.data.action === "approve") {
      const result = await approveSellerApplication(prisma, {
        applicationId: id,
        adminId: admin.id,
        confirmDuplicateVoen: parsed.data.confirmDuplicateVoen,
        adminNote: parsed.data.adminNote,
        enqueue: (tx, email) => enqueueEmail(tx, email),
      });
      return json({ ok: true, status: "APPROVED", vendorProfileId: result.vendorProfileId, message: "Müraciət təsdiqləndi. Hesab satıcı hesabına çevrildi." });
    }
    await rejectSellerApplication(prisma, {
      applicationId: id,
      adminId: admin.id,
      reason: parsed.data.reason,
      adminNote: parsed.data.adminNote,
      enqueue: (tx, email) => enqueueEmail(tx, email),
    });
    return json({ ok: true, status: "REJECTED", message: "Müraciət rədd edildi. Səbəb müraciətçiyə göstəriləcək." });
  } catch (error) {
    if (error instanceof SellerApplicationError) {
      if (error.code === "NOT_FOUND") return json({ error: SELLER_APPLICATION_MESSAGES.notFound, code: error.code }, 404);
      if (error.code === "NOT_PENDING") return json({ error: SELLER_APPLICATION_MESSAGES.notPending, code: error.code }, 409);
      if (error.code === "ACCOUNT_CHANGED") return json({ error: "Müraciətçinin hesabı artıq aktiv, təsdiqlənmiş müştəri hesabı deyil.", code: error.code }, 409);
      if (error.code === "DUPLICATE_VOEN_UNCONFIRMED") {
        return json({ error: "Bu VÖEN başqa satıcıda və ya açıq müraciətdə var. Təsdiq üçün bunu ayrıca qəbul edin.", code: error.code, ...error.detail }, 409);
      }
    }
    console.error(JSON.stringify({ event: "seller_application.review.failed", name: error instanceof Error ? error.name : "unknown" }));
    return json({ error: SELLER_APPLICATION_MESSAGES.unavailable }, 500);
  }
}
