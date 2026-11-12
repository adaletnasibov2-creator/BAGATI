import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runStoreReviewTransaction } from "@/lib/store-review-transaction";
import {
  COMPLIMENTARY_MESSAGES,
  complimentaryEndsAtSchema,
  complimentaryReasonSchema,
  complimentaryTierSchema,
  parseComplimentaryEndsAt,
} from "@/lib/complimentary-entitlements";

const schema = z.object({
  action: z.enum(["approve", "reject", "suspend", "reactivate"]),
  reason: z.string().trim().max(500).optional(),
  /**
   * "Ödənişsiz satış (admin icazəsi)". Absent = OFF (the default): approval then requires an
   * ACTIVE, in-period paid subscription exactly as before. Only valid with action "approve".
   */
  complimentary: z.object({
    tier: complimentaryTierSchema.default("BASIC"),
    endsAt: complimentaryEndsAtSchema,
    reason: complimentaryReasonSchema,
  }).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "Bu əməliyyat üçün admin icazəsi tələb olunur." }, { status: 403 });
  const { storeId } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(storeId)) return NextResponse.json({ error: "Mağaza identifikatoru yanlışdır." }, { status: 422 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Sorğu məlumatları düzgün deyil." }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Qərar məlumatlarını yoxlayın." }, { status: 422 });
  if ((parsed.data.action === "reject" || parsed.data.action === "suspend") && !parsed.data.reason?.trim()) {
    return NextResponse.json({ error: "Rədd etmə və ya dayandırma səbəbini qeyd edin." }, { status: 422 });
  }
  const freeGrant = parsed.data.complimentary ?? null;
  if (freeGrant && parsed.data.action !== "approve") {
    return NextResponse.json({ error: "Ödənişsiz satış icazəsi yalnız təsdiq zamanı seçilə bilər." }, { status: 422 });
  }
  let freeGrantEndsAt: Date | null = null;
  if (freeGrant) {
    const parsedEnd = parseComplimentaryEndsAt(freeGrant.endsAt);
    if (!parsedEnd.ok) return NextResponse.json({ error: parsedEnd.error }, { status: 422 });
    freeGrantEndsAt = parsedEnd.endsAt;
  }

  try {
    const outcome = await prisma.$transaction((tx) => runStoreReviewTransaction(tx, {
      storeId,
      adminId: admin.id,
      action: parsed.data.action,
      reason: parsed.data.reason,
      freeGrant: freeGrant ? { tier: freeGrant.tier, endsAt: freeGrantEndsAt, reason: freeGrant.reason } : null,
    }), { isolationLevel: "Serializable" });

    if (outcome.kind === "NOT_FOUND") return NextResponse.json({ error: "Mağaza tapılmadı." }, { status: 404 });
    if (outcome.kind === "CONFLICT") return NextResponse.json({ error: "Mağazanın statusu dəyişib. Səhifəni yeniləyin." }, { status: 409 });
    if (outcome.kind === "ALREADY_GRANTED") return NextResponse.json({ error: COMPLIMENTARY_MESSAGES.alreadyGranted }, { status: 409 });
    if (outcome.kind === "INVALID_DECISION") {
      if (outcome.error === "LEGAL_INFORMATION_INCOMPLETE") {
        return NextResponse.json({
          error: `Təsdiqdən əvvəl hüquqi məlumatları tamamlayın: ${outcome.missing.join(", ") || "Satıcı növü"}.`,
          missingFields: outcome.missing,
        }, { status: 422 });
      }
      if (outcome.error === "REASON_REQUIRED") return NextResponse.json({ error: "Qərar səbəbini daxil edin." }, { status: 422 });
      return NextResponse.json({ error: "Bu statusda seçilmiş qərar mümkün deyil." }, { status: 409 });
    }

    const message = outcome.action === "STORE_REJECT"
      ? "Mağaza müraciəti rədd edildi."
      : outcome.action === "STORE_SUSPEND"
        ? "Mağaza dayandırıldı."
        : outcome.item?.isActive
          ? `Mağaza aktivləşdirildi${outcome.freeGrantTier ? ` (ödənişsiz satış, ${outcome.freeGrantTier})` : ""}. ${outcome.products?.published.length ?? 0} qaralama məhsul yayımlandı; ${outcome.products?.skipped.length ?? 0} məhsul səbəblərinə görə qaralama qaldı.`
          : `Mağaza təsdiqləndi, lakin satış bağlı qaldı: ${outcome.activationBlockers.join(" ")}`;
    return NextResponse.json({
      item: outcome.item,
      message,
      activationBlockers: outcome.activationBlockers,
      products: outcome.products,
      adminManaged: outcome.adminManaged,
      freeGrantTier: outcome.freeGrantTier,
    });
  } catch (error) {
    const prismaCode = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
    if ((error instanceof Error && error.message === "STORE_STATUS_CHANGED") || prismaCode === "P2002" || prismaCode === "P2034") {
      return NextResponse.json({ error: "Mağazanın statusu dəyişib. Səhifəni yeniləyin." }, { status: 409 });
    }
    return NextResponse.json({ error: "Mağaza qərarını saxlamaq mümkün olmadı." }, { status: 500 });
  }
}
