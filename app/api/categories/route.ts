import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { categoriesWithOtherLast } from "@/lib/category-order";
export async function GET() { const rows = await prisma.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, slug: true, parentId: true } }); return NextResponse.json({ items: categoriesWithOtherLast(rows) }); }
