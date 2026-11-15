import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { moveProductsToCategory } from "@/lib/admin-category-service";
import { adminForbidden, runCategoryAdmin } from "@/lib/admin-category-route";

/** Bulk "Məhsulları köçür": max 100 products, version-checked, one audit row. */
export async function POST(request: NextRequest) {
  const admin = await requireRole("ADMIN");
  if (!admin) return adminForbidden();
  return runCategoryAdmin(request, "admin_category_move_products", (body) => moveProductsToCategory(prisma, admin.id, body));
}
