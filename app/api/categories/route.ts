import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sortCategories } from "@/lib/category-tree";

/** Flat list of active categories (with parentId, so clients can build the tree), in display order. */
export async function GET() {
  const rows = await prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true, slug: true, parentId: true, sortOrder: true, iconKey: true } });
  return NextResponse.json({ items: sortCategories(rows) });
}
