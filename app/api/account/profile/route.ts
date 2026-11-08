import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({ firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80), phone: z.string().trim().max(30).optional() });
export async function GET() {
  const user = await requireRole("CUSTOMER");
  if (!user) return NextResponse.json({ error: "Giriş tələb olunur" }, { status: 401 });
  const profile = await prisma.customerProfile.findUnique({ where: { userId: user.id } });
  return NextResponse.json({ profile, email: user.email });
}
export async function PATCH(request: NextRequest) {
  const user = await requireRole("CUSTOMER");
  if (!user) return NextResponse.json({ error: "Giriş tələb olunur" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Yanlış JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Profil məlumatlarını yoxlayın", details: parsed.error.flatten() }, { status: 400 });
  const profile = await prisma.customerProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, ...parsed.data }, update: parsed.data });
  return NextResponse.json({ profile });
}

