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
import { bakuDateKey, bakuDayStartUtc, DASHBOARD_DAYS, fillDailyActivity, lastBakuDays, type DailyActivity } from "@/lib/admin-power-1";

type Db = Pick<PrismaClient, "$queryRaw" | "vendorApplication" | "supportTicket" | "conversationReport" | "order" | "returnRequest" | "emailOutbox" | "vendorProfile">;
type DayRow = { day: string; n: number | bigint };
type CountRow = { n: number | bigint };

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

/**
 * ADMIN-3-TODAY-1: active products with at least one stock row that is low. Same rule as the seller dashboard
 * (app/vendor/[storeId]/page.tsx) and the seller inventory panel: available = quantity - reserved, low when
 * 0 < available <= that row's lowStockThreshold (default 5; no new setting). Counted once per product.
 * The ACTIVE products are found through Product(status, ...) and their stock rows through Inventory(productId).
 */
export function lowStockActiveProductsQuery(): Prisma.Sql {
  return Prisma.sql`SELECT COUNT(DISTINCT p."id")::int AS n FROM "Product" p JOIN "Inventory" i ON i."productId" = p."id"
    WHERE p."status" = 'ACTIVE'::"ProductStatus" AND i."quantity" - i."reserved" > 0 AND i."quantity" - i."reserved" <= i."lowStockThreshold"`;
}

/** The two chart series (30 rows, oldest first) and the queue counts that are not on the page already. */
export async function loadDashboardActivity(db: Db, now: Date, messagingEnabled: boolean): Promise<{
  days: DailyActivity[];
  pendingApplications: number;
  openSupport: number;
  openReports: number | null;
  ordersToday: number;
  returnsWaiting: number;
  supportInProgress: number;
  failedEmails: number;
  lowStockProducts: number;
  sellersWithoutStore: number;
}> {
  const days = lastBakuDays(now, DASHBOARD_DAYS);
  const start = bakuDayStartUtc(days[0]);
  const todayStart = bakuDayStartUtc(bakuDateKey(now));
  const [orders, stores, pendingApplications, openSupport, openReports, ordersToday, returnsWaiting, supportInProgress, failedEmails, lowStock, sellersWithoutStore] = await Promise.all([
    db.$queryRaw<DayRow[]>(dailyOrdersQuery(start)),
    db.$queryRaw<DayRow[]>(dailyStoresQuery(start)),
    db.vendorApplication.count({ where: { status: "PENDING" } }),
    db.supportTicket.count({ where: { status: "OPEN" } }),
    // Through the messaging admin service (the only admin code allowed near conversations); a count only.
    messagingEnabled ? countOpenConversationReports(db) : Promise.resolve(null),
    // ADMIN-3-TODAY-1 (counts only, in this same Promise.all):
    // orders since 00:00 Baku today: every status listed, so Order(status, createdAt) serves it (as the chart query).
    db.order.count({ where: { status: { in: ALL_ORDER_STATUSES }, createdAt: { gte: todayStart } } }),
    // returns waiting a decision (one row per return request).
    db.returnRequest.count({ where: { status: "REQUESTED" } }),
    // SupportTicket(status, createdAt).
    db.supportTicket.count({ where: { status: "IN_PROGRESS" } }),
    // EmailOutbox(status, availableAt).
    db.emailOutbox.count({ where: { status: "FAILED" } }),
    db.$queryRaw<CountRow[]>(lowStockActiveProductsQuery()),
    // Approved sellers (role VENDOR, active) whose profile has no store yet; VendorProfile is one row per seller and
    // Store(vendorId, cityId) answers "has a store".
    db.vendorProfile.count({ where: { stores: { none: {} }, user: { role: "VENDOR", isActive: true } } }),
  ]);
  return {
    days: fillDailyActivity(days, orders, stores), pendingApplications, openSupport, openReports,
    ordersToday, returnsWaiting, supportInProgress, failedEmails, lowStockProducts: Number(lowStock[0]?.n ?? 0), sellersWithoutStore,
  };
}
