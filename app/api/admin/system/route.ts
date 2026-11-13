import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { parseSystemStatusCard } from "@/lib/admin-system-status";
import { loadSystemStatusCard } from "@/lib/admin-system-status-cards";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** One card per request so a failing query only marks its own card as unavailable. Read-only. */
export async function GET(request: NextRequest) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403, headers });
  const card = parseSystemStatusCard(request.nextUrl.searchParams.get("card"));
  if (!card) return NextResponse.json({ error: "Naməlum kart" }, { status: 422, headers });
  try {
    const result = await loadSystemStatusCard(card, { refresh: request.nextUrl.searchParams.get("refresh") === "1" });
    return NextResponse.json({ ok: true, card, ...result }, { headers });
  } catch (error) {
    // Only the error class and Prisma code are logged; messages can contain connection details.
    const code = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "";
    console.error(`admin system status card "${card}" unavailable (${error instanceof Error ? error.name : "unknown"}${code ? ` ${code}` : ""})`);
    return NextResponse.json({ ok: false, card }, { status: 200, headers });
  }
}
