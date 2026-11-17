import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { csrfRejection } from "@/lib/csrf";
import { decideReport } from "@/lib/messaging-admin";
import { prisma } from "@/lib/prisma";
import { readJsonBodyLimited } from "@/lib/request-json";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers });

/**
 * ADMIN marks an OPEN messaging report REVIEWED or DISMISSED. Same-origin only; audited in the same transaction
 * (CONVERSATION_REPORT_REVIEWED / _DISMISSED). Works while messaging is OFF: existing reports still need a decision.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ reportId: string }> }) {
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const admin = await requireRole("ADMIN");
  if (!admin) return json({ error: "İcazə yoxdur" }, 403);
  const { reportId } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(reportId)) return json({ error: "Şikayət tapılmadı." }, 404);
  const body = await readJsonBodyLimited(request, 1024);
  if (!body.ok) return json({ error: "Sorğu məlumatı yanlışdır." }, body.status);
  const status = (body.value as { status?: unknown } | null)?.status;
  if (status !== "REVIEWED" && status !== "DISMISSED") return json({ error: "Qərarı seçin." }, 422);
  try {
    const outcome = await decideReport(prisma, { reportId, adminId: admin.id, status });
    if (outcome.result === "NOT_FOUND") return json({ error: "Şikayət tapılmadı." }, 404);
    if (outcome.result === "ALREADY_DECIDED") return json({ error: "Bu şikayət artıq baxılıb.", status: outcome.status }, 409);
    return json({ ok: true, status: outcome.status });
  } catch {
    console.error(JSON.stringify({ event: "messaging.admin.decide.failed" }));
    return json({ error: "Əməliyyat alınmadı. Bir az sonra yenidən cəhd edin." }, 503);
  }
}
