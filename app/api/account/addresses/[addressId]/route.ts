import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({ cityId: z.string().min(1).optional(), recipientName: z.string().trim().min(2).max(120).optional(), phone: z.string().trim().min(7).max(30).optional(), line1: z.string().trim().min(4).max(240).optional(), line2: z.string().trim().max(240).nullable().optional(), label: z.string().trim().max(60).nullable().optional(), postalCode: z.string().trim().max(20).nullable().optional(), latitude: z.number().finite().min(-90).max(90).nullable().optional(), longitude: z.number().finite().min(-180).max(180).nullable().optional(), isDefault: z.boolean().optional() });
type Context = { params: Promise<{ addressId: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  const user = await requireRole("CUSTOMER");
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { addressId } = await params;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Review the address details", details: parsed.error.flatten() }, { status: 422 });
  if ((parsed.data.latitude == null) !== (parsed.data.longitude == null)) return NextResponse.json({ error: "Xəritə koordinatları birlikdə daxil edilməlidir" }, { status: 422 });
  const existing = await prisma.address.findFirst({ where: { id: addressId, userId: user.id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Address not found" }, { status: 404 });
  if (parsed.data.cityId && !await prisma.city.findFirst({ where: { id: parsed.data.cityId, isActive: true }, select: { id: true } })) return NextResponse.json({ error: "Active city not found" }, { status: 422 });
  const item = await prisma.$transaction(async transaction => {
    const tx: any = transaction;
    if (parsed.data.isDefault) await tx.address.updateMany({ where: { userId: user.id, NOT: { id: addressId } }, data: { isDefault: false } });
    return tx.address.update({ where: { id: addressId }, data: parsed.data, include: { city: { select: { id: true, name: true } } } });
  });
  return NextResponse.json({ item });
}

export async function DELETE(_request: Request, { params }: Context) {
  const user = await requireRole("CUSTOMER");
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { addressId } = await params;
  const result = await prisma.address.deleteMany({ where: { id: addressId, userId: user.id } });
  if (!result.count) return NextResponse.json({ error: "Address not found" }, { status: 404 });
  const remaining = await prisma.address.findFirst({ where: { userId: user.id }, select: { id: true } });
  if (remaining) await prisma.address.update({ where: { id: remaining.id }, data: { isDefault: true } });
  return NextResponse.json({ deleted: true });
}
