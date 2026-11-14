import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { csrfRejection } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { readJsonBodyLimited } from "@/lib/request-json";
import { logSecurityOperationFailure } from "@/lib/security-logging";
import { revokeVoenVerification, verifyVoen, VOEN_BULK_MAX, VOEN_NOTE_MAX, VOEN_NOTE_MIN, VoenVerificationError } from "@/lib/voen-verification";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const id = z.string().min(1).max(64);
const voen = z.string().min(1).max(40);
const note = z.string().max(2000);
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify"), userId: id, voen, note }).strict(),
  z.object({ action: z.literal("revoke"), userId: id, voen, note }).strict(),
  z.object({ action: z.literal("verify-many"), items: z.array(z.object({ userId: id, voen }).strict()).min(1).max(VOEN_BULK_MAX), note }).strict(),
]);

const MESSAGES: Record<VoenVerificationError["code"], [string, number]> = {
  INVALID_VOEN: ["VÖEN formatı yanlışdır; təsdiq mümkün deyil.", 422],
  INVALID_NOTE: [`Qısa qeyd yazın (${VOEN_NOTE_MIN}–${VOEN_NOTE_MAX} simvol): nəyi yoxladınız.`, 422],
  STALE: ["Satıcının VÖEN-i bu vaxt dəyişib. Səhifəni yeniləyin.", 409],
  ALREADY_VERIFIED: ["Bu VÖEN artıq təsdiqlənib.", 409],
  NOT_VERIFIED: ["Bu VÖEN təsdiqlənməyib; geri götürüləcək təsdiq yoxdur.", 409],
};

/**
 * Admin VÖEN verification: "VÖEN təsdiqləndi" (verify), "Təsdiqi geri götür" (revoke) and bulk verify with one note.
 * Order: same-origin -> ADMIN -> bounded body -> validation -> one audited transaction per seller.
 */
export async function POST(request: Request) {
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403, headers });
  const body = await readJsonBodyLimited(request, 16 * 1024);
  if (!body.ok) return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: body.status, headers });
  const parsed = bodySchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: 422, headers });
  try {
    if (parsed.data.action === "verify-many") {
      const result = { verified: 0, skipped: 0 };
      for (const item of parsed.data.items) {
        try {
          await verifyVoen(prisma, { adminId: admin.id, userId: item.userId, voen: item.voen, note: parsed.data.note });
          result.verified += 1;
        } catch (error) {
          if (error instanceof VoenVerificationError && error.code === "INVALID_NOTE") throw error;
          if (!(error instanceof VoenVerificationError)) throw error;
          result.skipped += 1;
        }
      }
      return NextResponse.json({ ...result, message: `${result.verified} VÖEN təsdiqləndi${result.skipped ? `, ${result.skipped} keçildi (dəyişib, formatı yanlışdır və ya artıq təsdiqlənib)` : ""}.` }, { headers });
    }
    const input = { adminId: admin.id, userId: parsed.data.userId, voen: parsed.data.voen, note: parsed.data.note };
    if (parsed.data.action === "verify") await verifyVoen(prisma, input);
    else await revokeVoenVerification(prisma, input);
    return NextResponse.json({ message: parsed.data.action === "verify" ? "VÖEN təsdiqləndi." : "Təsdiq geri götürüldü." }, { headers });
  } catch (error) {
    if (error instanceof VoenVerificationError) {
      const [message, status] = MESSAGES[error.code];
      return NextResponse.json({ error: message, code: error.code }, { status, headers });
    }
    logSecurityOperationFailure("admin_voen_verification", error);
    return NextResponse.json({ error: "Yadda saxlamaq alınmadı." }, { status: 503, headers });
  }
}
