import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { acceptSellerTermsInPanel } from "@/lib/legal-gates";
import { readJsonBodyLimited } from "@/lib/request-json";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ accept: z.literal(true) }).strict();

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * The seller panel card: the signed-in, active seller accepts the CURRENT seller terms for themself (source
 * SELLER_PANEL). The user id comes from the session only; an admin cannot accept on a seller's behalf. CSRF is checked
 * by middleware.ts for every state-changing /api request. A repeat accept records nothing new.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user || user.role !== "VENDOR") return json({ error: "Satıcı hesabına giriş tələb olunur" }, 403);
  const body = await readJsonBodyLimited(request, 1024);
  if (!body.ok) return json({ error: "Sorğu məlumatı yanlışdır" }, body.status);
  if (!bodySchema.safeParse(body.value).success) return json({ error: "Davam etmək üçün Satıcı şərtləri ilə razılığınızı təsdiqləyin." }, 422);
  const profile = await prisma.vendorProfile.findUnique({ where: { userId: user.id }, select: { id: true, user: { select: { isActive: true } } } });
  if (!profile || !profile.user.isActive) return json({ error: "Satıcı profili tapılmadı" }, 403);
  try {
    const result = await acceptSellerTermsInPanel(prisma, user.id);
    return json({ ok: true, created: result.created, version: result.version }, 200);
  } catch (error) {
    console.error(JSON.stringify({ event: "seller_terms.accept.failed", name: error instanceof Error ? error.name : "unknown" }));
    return json({ error: "Təsdiqi saxlamaq mümkün olmadı. Bir az sonra yenidən cəhd edin." }, 503);
  }
}
