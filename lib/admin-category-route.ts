import { NextResponse, type NextRequest } from "next/server";
import { csrfRejection } from "@/lib/csrf";
import { CategoryAdminError } from "@/lib/admin-category-service";
import { logSecurityOperationFailure } from "@/lib/security-logging";
import { invalidatePublicCategoryCache } from "@/lib/public-category-tree";

export function adminForbidden() {
  return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
}

/**
 * Shared part of /api/admin/category-tree/*, called after the route's own requireRole("ADMIN") check:
 * same-origin check, JSON body, error mapping.
 */
export async function runCategoryAdmin(
  request: NextRequest,
  operation: string,
  work: (body: unknown) => Promise<unknown>,
  { status = 200, readBody = true }: { status?: number; readBody?: boolean } = {},
) {
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  let body: unknown = null;
  if (readBody) {
    try { body = await request.json(); } catch { return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: 400 }); }
  }
  try {
    const item = await work(body);
    // Every category-tree write (create, edit, activate/deactivate, delete, reorder, move products) has committed here.
    invalidatePublicCategoryCache();
    return NextResponse.json({ item }, { status });
  } catch (error) {
    return categoryAdminFailure(error, operation);
  }
}

export function categoryAdminFailure(error: unknown, operation: string) {
  if (error instanceof CategoryAdminError) {
    return NextResponse.json({ error: error.message, ...(error.details ? { details: error.details } : {}) }, { status: error.status });
  }
  logSecurityOperationFailure(operation, error);
  return NextResponse.json({ error: "Əməliyyat tamamlana bilmədi" }, { status: 503 });
}
