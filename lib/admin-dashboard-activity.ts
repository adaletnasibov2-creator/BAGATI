/**
 * ADMIN-POWER-1: dashboard reads for the "Son 30 gün" chart and the "Diqqət tələb edir" queue.
 *
 * Every read is a COUNT (no row lists) bounded to the last 30 Baku days or to one status, and they run in parallel:
 * - orders per Baku day: GROUP BY over Order with `status = ANY(every OrderStatus)` + createdAt >= start, so the
 *   existing Order(status, createdAt) index serves both conditions (there is no createdAt-only index; no migration);
 * - new stores per Baku day: GROUP BY over Store, createdAt >= start. Store has no createdAt index; the table holds one
 *   row per store, so this is a small bounded scan (measured on 5433, see the report);
 * - VendorApplication(status, createdAt), SupportTicket(status, createdAt), ConversationReport(status, createdAt).
 * Days are Baku calendar days. Columns are timestamp(3) in UTC, so the day is
 * ((createdAt AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Baku')::date and bounds go through utcTimestamp(): the result
 * does not depend on the database session time zone.
 */
import { OrderStatus, Prisma, type PrismaClient } from "@prisma/client";
import { utcTimestamp } from "@/lib/sql-timestamp";
import { countOpenConversationReports } from "@/lib/messaging-admin";
import { bakuDayStartUtc, DASHBOARD_DAYS, fillDailyActivity, lastBakuDays, type DailyActivity } from "@/lib/admin-power-1";

type Db = Pick<PrismaClient, "$queryRaw" | "vendorApplication" | "supportTicket" | "conversationReport">;
type DayRow = { day: string; n: number | bigint };

const BAKU_DAY = Prisma.sql`to_char(((("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Baku')::date), 'YYYY-MM-DD')`;
export const ALL_ORDER_STATUSES = Object.values(OrderStatus);

export function dailyOrdersQuery(start: Date): Prisma.Sql {
  return Prisma.sql`SELECT ${BAKU_DAY} AS day, COUNT(*)::int AS n FROM "Order"
    WHERE "status" = ANY(${ALL_ORDER_STATUSES}::"OrderStatus"[]) AND "createdAt" >= ${utcTimestamp(start)}
    GROUP BY 1`;
}

export function dailyStoresQuery(start: Date): Prisma.Sql {
  return Prisma.sql`SELECT ${BAKU_DAY} AS day, COUNT(*)::int AS n FROM "Store" WHERE "createdAt" >= ${utcTimestamp(start)} GROUP BY 1`;
}

/** The two chart series (30 rows, oldest first) and the queue counts that are not on the page already. */
export async function loadDashboardActivity(db: Db, now: Date, messagingEnabled: boolean): Promise<{
  days: DailyActivity[];
  pendingApplications: number;
  openSupport: number;
  openReports: number | null;
}> {
  const days = lastBakuDays(now, DASHBOARD_DAYS);
  const start = bakuDayStartUtc(days[0]);
  const [orders, stores, pendingApplications, openSupport, openReports] = await Promise.all([
    db.$queryRaw<DayRow[]>(dailyOrdersQuery(start)),
    db.$queryRaw<DayRow[]>(dailyStoresQuery(start)),
    db.vendorApplication.count({ where: { status: "PENDING" } }),
    db.supportTicket.count({ where: { status: "OPEN" } }),
    // Through the messaging admin service (the only admin code allowed near conversations); a count only.
    messagingEnabled ? countOpenConversationReports(db) : Promise.resolve(null),
  ]);
  return { days: fillDailyActivity(days, orders, stores), pendingApplications, openSupport, openReports };
}
