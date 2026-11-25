/**
 * ADMIN-POWER-1: GET /api/admin/search?q= for the top-bar admin search.
 * ADMIN only (403 otherwise), in-process rate limit per admin and IP (429), 2-120 characters (422), LIKE wildcards
 * escaped, at most 5 rows per group, display fields only (lib/admin-global-search.ts). Read-only; never cached.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { adminGlobalSearch } from "@/lib/admin-global-search";
import { ADMIN_POWER_1_TEXT, ADMIN_SEARCH_RATE_LIMIT, parseAdminSearchTerm } from "@/lib/admin-power-1";
import { allowAdminRequest } from "@/lib/admin-request-limit";
import { rateLimitedResponse } from "@/lib/rate-limit-response";

export const dynamic = "force-dynamic";
const PRIVATE = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403, headers: PRIVATE });
  if (!allowAdminRequest("admin-search", admin.id, request.headers, ADMIN_SEARCH_RATE_LIMIT)) return rateLimitedResponse(60);
  const term = parseAdminSearchTerm(request.nextUrl.searchParams.get("q"));
  if (!term.ok) return NextResponse.json({ error: ADMIN_POWER_1_TEXT.searchMin }, { status: 422, headers: PRIVATE });
  try {
    return NextResponse.json({ results: await adminGlobalSearch(prisma, term) }, { headers: PRIVATE });
  } catch (error) {
    console.error("[admin-search]", error instanceof Error ? error.message : "failed");
    return NextResponse.json({ error: ADMIN_POWER_1_TEXT.searchError }, { status: 500, headers: PRIVATE });
  }
}
