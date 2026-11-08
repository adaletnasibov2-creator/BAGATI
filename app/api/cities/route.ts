import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET() { const items = await prisma.city.findMany({ where: { isActive: true }, select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } }); return NextResponse.json({ items }); }
