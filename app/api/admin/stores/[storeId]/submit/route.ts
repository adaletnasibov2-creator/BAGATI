import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { submitStoreForReviewAsAdmin, type AdminStoreSubmitDb } from "@/lib/admin-store-submit";

/**
 * ADMIN-3-ONBOARD-1: the admin sends a DRAFT store for review (same checks and messages as the seller's
 * "Yoxlamaya göndər"; lib/admin-store-submit.ts). Status change and audit row in one transaction; idempotent.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "Bu əməliyyat üçün admin icazəsi tələb olunur." }, { status: 403 });
  const { storeId } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(storeId)) return NextResponse.json({ error: "Mağaza identifikatoru yanlışdır." }, { status: 422 });
  try {
    const result = await submitStoreForReviewAsAdmin(prisma as unknown as AdminStoreSubmitDb, { storeId, adminId: admin.id });
    if (!result.ok) return NextResponse.json({ error: result.error, ...(result.missingFields ? { missingFields: result.missingFields } : {}) }, { status: result.httpStatus });
    return NextResponse.json({ item: { id: storeId, status: result.status }, changed: result.changed, message: result.message });
  } catch {
    return NextResponse.json({ error: "Mağaza qərarını saxlamaq mümkün olmadı." }, { status: 500 });
  }
}
