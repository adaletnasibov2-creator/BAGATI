import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CategoryAdminError, reorderCategory } from "@/lib/admin-category-service";
import { adminForbidden, runCategoryAdmin } from "@/lib/admin-category-route";

/** Move one place up or down among its siblings (works on mobile; no drag needed). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ categoryId: string }> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) return adminForbidden();
  const { categoryId } = await params;
  return runCategoryAdmin(request, "admin_category_reorder", (body) => {
    const parsed = z.object({ direction: z.enum(["up", "down"]) }).strict().safeParse(body);
    if (!parsed.success) throw new CategoryAdminError(422, "İstiqamət yanlışdır.");
    return reorderCategory(prisma, admin.id, categoryId, parsed.data.direction);
  });
}
