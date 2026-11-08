import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({ cityId: z.string().min(1), recipientName: z.string().trim().min(2).max(120), phone: z.string().trim().min(7).max(30), line1: z.string().trim().min(4).max(240), line2: z.string().trim().max(240).optional(), label: z.string().trim().max(60).optional(), postalCode: z.string().trim().max(20).optional(), latitude: z.number().finite().min(-90).max(90).nullable().optional(), longitude: z.number().finite().min(-180).max(180).nullable().optional(), isDefault: z.boolean().optional() });
export async function GET() {
  const user = await requireRole("CUSTOMER");
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const items = await prisma.address.findMany({ where: { userId: user.id }, include: { city: { select: { id: true, name: true } } }, orderBy: [{ isDefault: "desc" }, { id: "desc" }] });
  return NextResponse.json({ items });
}
export async function POST(request: NextRequest) {
  const user = await requireRole("CUSTOMER");
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Review the address details", details: parsed.error.flatten() }, { status: 400 });
  if ((parsed.data.latitude == null) !== (parsed.data.longitude == null)) return NextResponse.json({ error: "Xəritə koordinatları birlikdə daxil edilməlidir" }, { status: 422 });
  const city = await prisma.city.findFirst({ where: { id: parsed.data.cityId, isActive: true }, select: { id: true } });
  if (!city) return NextResponse.json({ error: "Active city not found" }, { status: 400 });
  const hasAddress = await prisma.address.count({ where: { userId: user.id } });
  const item = await prisma.$transaction(async transaction => {
    const tx: any = transaction;
    const makeDefault = parsed.data.isDefault === true || hasAddress === 0;
    if (makeDefault) await tx.address.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
    return tx.address.create({ data: { ...parsed.data, userId: user.id, isDefault: makeDefault } });
  });
  return NextResponse.json({ item }, { status: 201 });
}
