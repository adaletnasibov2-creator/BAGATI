import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { csrfRejection } from "@/lib/csrf";
import { currentSessionId, requireRole } from "@/lib/auth";
import { readJsonBodyLimited } from "@/lib/request-json";
import { revokeOtherOwnSessions, revokeOwnSession } from "@/lib/admin-sessions";

const headers = { "Cache-Control": "no-store" };
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("revoke"), sessionId: z.string().uuid() }),
  z.object({ action: z.literal("revoke-others") }),
]);

/** The signed-in admin ends one of their own sessions or all other sessions. Every action is audited. */
export async function POST(request: NextRequest) {
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403, headers });
  const body = await readJsonBodyLimited(request, 1_024);
  const parsed = body.ok ? schema.safeParse(body.value) : null;
  if (!parsed?.success) return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: 400, headers });
  const current = await currentSessionId();
  if (parsed.data.action === "revoke-others") {
    const revoked = await revokeOtherOwnSessions(admin.id, current, "manual");
    return NextResponse.json({ ok: true, revoked, message: revoked ? `${revoked} sessiya bağlandı.` : "Başqa aktiv sessiya yoxdur." }, { headers });
  }
  const result = await revokeOwnSession(admin.id, parsed.data.sessionId, current);
  if (result.reason === "current") return NextResponse.json({ error: "Cari sessiyanı bağlamaq üçün çıxış edin." }, { status: 409, headers });
  if (!result.revoked) return NextResponse.json({ error: "Sessiya tapılmadı və ya artıq bağlanıb." }, { status: 404, headers });
  return NextResponse.json({ ok: true, revoked: 1, message: "Sessiya bağlandı." }, { headers });
}
