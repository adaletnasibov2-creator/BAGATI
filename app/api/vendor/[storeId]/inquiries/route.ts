import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStoreAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.union([
  z.object({ id: z.string().min(1).max(64) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);

/** Seller marks one message, or all new messages, of their own store as read. */
export async function PATCH(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const access = await requireStoreAccess(storeId);
  if (!access) return NextResponse.json({ error: "Bu mağazaya giriş icazəniz yoxdur." }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Sorğu məlumatı yanlışdır." }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Mesaj seçimi yanlışdır." }, { status: 422 });
  const where = "id" in parsed.data
    ? { id: parsed.data.id, storeId: access.storeId, status: "NEW" as const }
    : { storeId: access.storeId, status: "NEW" as const };
  const updated = await prisma.storeInquiry.updateMany({ where, data: { status: "READ", readAt: new Date() } });
  return NextResponse.json({ updated: updated.count }, { headers: { "Cache-Control": "no-store" } });
}
