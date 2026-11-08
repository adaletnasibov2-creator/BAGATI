import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const [cities, vendors] = await Promise.all([
    prisma.city.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.vendorProfile.findMany({ where: { user: { isActive: true } }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true, user: { select: { email: true } } } }),
  ]);
  return NextResponse.json({ cities, vendors: vendors.map(({ id, displayName, user }: { id: string; displayName: string; user: { email: string } }) => ({ id, name: `${displayName} · ${user.email}` })) });
}
