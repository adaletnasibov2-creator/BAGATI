import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  changeComplimentary,
  COMPLIMENTARY_MESSAGES,
  complimentaryEndsAtSchema,
  complimentaryReasonSchema,
  complimentaryTierSchema,
  grantComplimentary,
  parseComplimentaryEndsAt,
  revokeComplimentary,
} from "@/lib/complimentary-entitlements";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("grant"), tier: complimentaryTierSchema.default("BASIC"), endsAt: complimentaryEndsAtSchema, reason: complimentaryReasonSchema }),
  z.object({ action: z.literal("change"), tier: complimentaryTierSchema, endsAt: complimentaryEndsAtSchema, reason: complimentaryReasonSchema }),
  z.object({ action: z.literal("revoke"), reason: complimentaryReasonSchema }),
]);

/** Admin-only: grant, change (tier / end date) or revoke a store's free selling grant. Every action needs a reason and is audited. */
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "Bu əməliyyat üçün admin icazəsi tələb olunur." }, { status: 403 });
  const { storeId } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(storeId)) return NextResponse.json({ error: "Mağaza identifikatoru yanlışdır." }, { status: 422 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Sorğu məlumatları düzgün deyil." }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Əməliyyatı, paketi, bitmə tarixini və səbəbi (ən azı 8 simvol) yoxlayın.", details: parsed.error.flatten() }, { status: 422 });
  const input = parsed.data;
  let endsAt: Date | null = null;
  if (input.action !== "revoke") {
    const parsedEnd = parseComplimentaryEndsAt(input.endsAt);
    if (!parsedEnd.ok) return NextResponse.json({ error: parsedEnd.error }, { status: 422 });
    endsAt = parsedEnd.endsAt;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Store" WHERE "id" = ${storeId} FOR UPDATE`;
      if (!locked.length) return { kind: "NOT_FOUND" as const };
      if (input.action === "grant") return grantComplimentary(tx, { storeId, adminId: admin.id, tier: input.tier, endsAt, reason: input.reason, source: "ADMIN_PANEL" });
      if (input.action === "change") return changeComplimentary(tx, { storeId, adminId: admin.id, tier: input.tier, endsAt, reason: input.reason });
      return revokeComplimentary(tx, { storeId, adminId: admin.id, reason: input.reason, source: "ADMIN_PANEL" });
    }, { isolationLevel: "Serializable" });

    switch (result.kind) {
      case "NOT_FOUND": return NextResponse.json({ error: "Mağaza tapılmadı." }, { status: 404 });
      case "ALREADY_GRANTED": return NextResponse.json({ error: COMPLIMENTARY_MESSAGES.alreadyGranted }, { status: 409 });
      case "NONE": return NextResponse.json({ error: COMPLIMENTARY_MESSAGES.none }, { status: 409 });
      case "GRANTED": return NextResponse.json({ ok: true, message: "Ödənişsiz satış icazəsi verildi. Mağaza gizlidirsə, aktivlik bölməsindən yayımlayın." });
      case "CHANGED": return NextResponse.json({ ok: true, message: "Ödənişsiz satış icazəsi yeniləndi." });
      case "REVOKED": return NextResponse.json({ ok: true, message: "Ödənişsiz satış icazəsi ləğv edildi. Ödənişli abunəlik yoxdursa, mağaza satışdan çıxır." });
    }
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
    if (code === "P2002" || code === "P2034" || (error instanceof Error && error.message === "COMPLIMENTARY_CONCURRENT_CHANGE")) {
      return NextResponse.json({ error: "Ödənişsiz satış icazəsi eyni vaxtda dəyişdirilib. Səhifəni yeniləyib təkrar edin." }, { status: 409 });
    }
    console.error(JSON.stringify({ event: "admin.complimentary.failed", storeId }));
    return NextResponse.json({ error: "Ödənişsiz satış icazəsi yenilənmədi." }, { status: 500 });
  }
}
