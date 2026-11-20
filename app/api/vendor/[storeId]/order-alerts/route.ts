import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { currentUser, requireStoreAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseOrderAlertsAfter } from "@/lib/vendor-order-alerts";

/**
 * New-order alerts for the seller panel (SELLER-ALERTS, part C). GET ?after=<ISO time>.
 * Answers ONLY { count, newestId, newestAt, serverTime }: how many of THIS store's orders are new (status NEW) and were
 * created after `after`. No customer data. Only the store's own seller (requireStoreAccess); 401 when signed out, so
 * the panel stops polling. One aggregate query served by the existing index StoreOrder(storeId, status, createdAt).
 * Without a valid `after` there is no query at all: the panel just gets the server time as its starting point.
 * Time zone: Prisma stores "createdAt" as UTC in a `timestamp` column without zone. `after` is therefore converted to
 * UTC explicitly; a plain Date parameter is compared in the session time zone (Asia/Baku on the verify database) and
 * missed every order of the last 4 hours (found in the scratch check).
 */
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const access = await requireStoreAccess(storeId);
  if (!access || access.user.role !== "VENDOR") return json({ error: "Unauthorized" }, (await currentUser()) ? 404 : 401);
  const now = new Date();
  const after = parseOrderAlertsAfter(request.nextUrl.searchParams.get("after"), now);
  if (!after) return json({ count: 0, newestId: null, newestAt: null, serverTime: now.toISOString() });
  const [row] = await prisma.$queryRaw<{ count: number; newestId: string | null; newestAt: Date | null }[]>(Prisma.sql`
    SELECT count(*)::int AS "count",
           (array_agg("id" ORDER BY "createdAt" DESC))[1] AS "newestId",
           max("createdAt") AS "newestAt"
    FROM "StoreOrder"
    WHERE "storeId" = ${access.storeId} AND "status" = 'NEW' AND "createdAt" > (${after.toISOString()}::timestamptz AT TIME ZONE 'UTC')
  `);
  return json({ count: row?.count ?? 0, newestId: row?.newestId ?? null, newestAt: row?.newestAt ? new Date(row.newestAt).toISOString() : null, serverTime: now.toISOString() });
}
