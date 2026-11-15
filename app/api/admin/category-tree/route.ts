import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createCategory } from "@/lib/admin-category-service";
import { adminForbidden, runCategoryAdmin } from "@/lib/admin-category-route";

/** Create a top-level (parentId null) or a subcategory. */
export async function POST(request: NextRequest) {
  const admin = await requireRole("ADMIN");
  if (!admin) return adminForbidden();
  return runCategoryAdmin(request, "admin_category_create", (body) => createCategory(prisma, admin.id, body), { status: 201 });
}
