import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteCategory, updateCategory } from "@/lib/admin-category-service";
import { adminForbidden, runCategoryAdmin } from "@/lib/admin-category-route";

type Params = { params: Promise<{ categoryId: string }> };

/** Edit name/slug/icon/photo/active, or move (parentId). */
export async function PATCH(request: NextRequest, { params }: Params) {
  const admin = await requireRole("ADMIN");
  if (!admin) return adminForbidden();
  const { categoryId } = await params;
  return runCategoryAdmin(request, "admin_category_update", (body) => updateCategory(prisma, admin.id, categoryId, body));
}

/** Only without products and subcategories; otherwise 409 with the reason (deactivate instead). */
export async function DELETE(request: NextRequest, { params }: Params) {
  const admin = await requireRole("ADMIN");
  if (!admin) return adminForbidden();
  const { categoryId } = await params;
  return runCategoryAdmin(request, "admin_category_delete", () => deleteCategory(prisma, admin.id, categoryId), { readBody: false });
}
