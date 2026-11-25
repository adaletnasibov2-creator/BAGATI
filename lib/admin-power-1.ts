/**
 * ADMIN-POWER-1: texts (owner: "mətnlər ok", T1-T22) and pure helpers for the dashboard chart and queue, the global
 * admin search and the admin list CSV exports. No database access here (see lib/admin-dashboard-activity.ts,
 * lib/admin-global-search.ts, lib/admin-list-export.ts).
 */
import { buildAdminReportCsv, type AdminReportCsvRow } from "@/lib/admin-report-csv";
import { normalizePublicSearchTerm } from "@/lib/search-term";
import { escapeLikePattern } from "@/lib/admin-audit-log";

/** Approved texts. Reused wording is marked; the rest is new (owner approval 2026-11-25). */
export const ADMIN_POWER_1_TEXT = {
  chartTitle: "Son 30 gün", // T1 (exists)
  chartOrders: "Sifarişlər", // T2 (exists)
  chartStores: "Yeni mağazalar", // T2 (exists)
  chartDate: "Tarix", // T2 (exists)
  chartSvgTitle: "Son 30 gün: sifarişlər və yeni mağazalar", // T3
  chartSvgDesc: "Hər gün üçün sifariş və yeni mağaza sayı, Bakı vaxtı ilə. Rəqəmlər cədvəldədir.", // T4
  attentionTitle: "Diqqət tələb edir", // T5 (exists)
  searchLabel: "Admin axtarışı", // T7
  searchPlaceholder: "Axtar…", // T8 (exists)
  searchMin: "Ən azı 2 simvol yazın.", // T9
  searchLoading: "Axtarılır…", // T10 (exists)
  searchEmpty: "Heç nə tapılmadı.", // T11
  searchError: "Axtarış alınmadı. Yenidən cəhd edin.", // T12
  groupStores: "Mağazalar", // T13 (exists)
  groupProducts: "Məhsullar", // T13 (exists)
  groupOrders: "Sifarişlər", // T13 (exists)
  groupUsers: "İstifadəçilər", // T13
  roleCustomer: "Müştəri", // T14 (exists)
  roleVendor: "Satıcı", // T14 (exists)
  searchOpen: "Axtarışı aç", // T15
  searchClose: "Axtarışı bağla", // T15
  all: "Hamısı", // T16 (exists)
  exportCsv: "CSV ixrac et", // T17
  exportCap: "Ən çox 5000 sətir.", // T18
  auditListExport: "Admin siyahısı ixrac edildi", // T21
} as const;

/** T22: back links on the detail pages (menu names + arrow). */
export const ADMIN_BACK_LINKS = {
  stores: { href: "/admin/stores", label: "← Mağazalar" },
  orders: { href: "/admin/orders", label: "← Sifarişlər" },
  customers: { href: "/admin/customers", label: "← Müştərilər" },
  vendors: { href: "/admin/vendors", label: "← Satıcılar" },
  sellerApplications: { href: "/admin/seller-applications", label: "← Satıcı müraciətləri" },
} as const;

/**
 * Existing wording reused in new places (queue items, detail-page facts, API errors), with a file of main (ac3823d)
 * that already shows it. scripts/admin-power-1.test.ts checks every entry against that file.
 */
export const ADMIN_POWER_1_REUSED: Readonly<Record<string, string>> = {
  "Son 30 gün": "app/admin/security-center/events/page.tsx",
  "Sifarişlər": "lib/admin-nav.ts",
  "Yeni mağazalar": "app/admin/page.tsx",
  "Diqqət tələb edir": "lib/security-center-status.ts",
  "Axtarılır…": "components/admin-product-import.tsx",
  "Mağazalar": "lib/admin-nav.ts",
  "Məhsullar": "lib/admin-nav.ts",
  "Müştəri": "app/admin/_sections/orders.tsx",
  "Satıcı": "app/admin/_sections/stores.tsx",
  "Hamısı": "components/admin-list-filters.tsx",
  "Satıcı müraciətləri": "lib/admin-nav.ts",
  "Yoxlama gözləyir": "app/admin/page.tsx",
  "Gözləyən sifarişlər": "app/admin/page.tsx",
  "Dəstək müraciətləri": "app/admin/_sections/support.tsx",
  "Mesaj şikayətləri": "lib/admin-nav.ts",
  "E-poçt təsdiqi gözləyənlər": "lib/admin-nav.ts",
  "Sifariş sayı": "app/admin/_sections/customer-detail.tsx",
  "Cəmi": "app/admin/_sections/orders.tsx",
  "İcazə yoxdur": "app/api/admin/reports/route.ts",
  "İxrac filtrlərini yoxlayın": "app/api/admin/products/export/route.ts",
  "Admin tərəfindən · ödənişsiz": "app/admin/_sections/stores.tsx",
};

/** The texts that did not exist anywhere before this task (for the text pins). */
export const ADMIN_POWER_1_NEW_TEXTS = [
  ADMIN_POWER_1_TEXT.chartSvgTitle, ADMIN_POWER_1_TEXT.chartSvgDesc, ADMIN_POWER_1_TEXT.searchLabel, ADMIN_POWER_1_TEXT.searchMin,
  ADMIN_POWER_1_TEXT.searchEmpty, ADMIN_POWER_1_TEXT.searchError, ADMIN_POWER_1_TEXT.groupUsers, ADMIN_POWER_1_TEXT.searchOpen,
  ADMIN_POWER_1_TEXT.searchClose, ADMIN_POWER_1_TEXT.exportCsv, ADMIN_POWER_1_TEXT.exportCap, ADMIN_POWER_1_TEXT.auditListExport,
  ...Object.values(ADMIN_BACK_LINKS).map((link) => link.label),
] as const;

// ---------------------------------------------------------------------------------------------------------------
// Baku days (Asia/Baku is UTC+4 all year; no daylight saving since 2016).
// ---------------------------------------------------------------------------------------------------------------

export const DASHBOARD_DAYS = 30;
const BAKU_OFFSET_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const bakuDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baku", year: "numeric", month: "2-digit", day: "2-digit" });

/** "YYYY-MM-DD" of the Baku calendar day that contains `date`. */
export function bakuDateKey(date: Date): string {
  return bakuDay.format(date);
}

/** The UTC instant at which the Baku day `key` starts (00:00 in Baku). */
export function bakuDayStartUtc(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - BAKU_OFFSET_MS);
}

/** The last `days` Baku days, oldest first, ending with today's Baku day. */
export function lastBakuDays(now: Date, days = DASHBOARD_DAYS): string[] {
  const today = bakuDayStartUtc(bakuDateKey(now)).getTime();
  return Array.from({ length: days }, (_, index) => bakuDateKey(new Date(today + BAKU_OFFSET_MS + (index - days + 1) * DAY_MS)));
}

export type DailyActivity = { day: string; orders: number; stores: number };

/** One row per day; a day without rows is 0 (nothing invented). Rows for other days are ignored. */
export function fillDailyActivity(days: readonly string[], orders: readonly { day: string; n: number | bigint }[], stores: readonly { day: string; n: number | bigint }[]): DailyActivity[] {
  const count = (rows: readonly { day: string; n: number | bigint }[]) => new Map(rows.map((row) => [row.day, Number(row.n)]));
  const o = count(orders), s = count(stores);
  return days.map((day) => ({ day, orders: o.get(day) ?? 0, stores: s.get(day) ?? 0 }));
}

/** "25.11" for chart labels. */
export function shortBakuDate(key: string): string {
  const [, m, d] = key.split("-");
  return `${d}.${m}`;
}

// ---------------------------------------------------------------------------------------------------------------
// "Diqqət tələb edir" queue: real counts, items at 0 are left out (the card is hidden when nothing is left).
// ---------------------------------------------------------------------------------------------------------------

export type AttentionCounts = {
  pendingApplications: number;
  storesInReview: number;
  pendingOrders: number;
  openSupport: number;
  /** null while messaging is off (the menu item is hidden too). */
  openReports: number | null;
  unverifiedAccounts: number;
};
export type AttentionItem = { key: keyof AttentionCounts; label: string; count: number; href: string };

export function attentionItems(counts: AttentionCounts, pendingOrdersHref: string): AttentionItem[] {
  const items: AttentionItem[] = [
    { key: "pendingApplications", label: "Satıcı müraciətləri", count: counts.pendingApplications, href: "/admin/seller-applications" },
    { key: "storesInReview", label: "Yoxlama gözləyir", count: counts.storesInReview, href: "/admin/stores?status=PENDING_REVIEW" },
    { key: "pendingOrders", label: "Gözləyən sifarişlər", count: counts.pendingOrders, href: pendingOrdersHref },
    { key: "openSupport", label: "Dəstək müraciətləri", count: counts.openSupport, href: "/admin/support?status=OPEN" },
    ...(counts.openReports === null ? [] : [{ key: "openReports" as const, label: "Mesaj şikayətləri", count: counts.openReports, href: "/admin/messages/reports" }]),
    { key: "unverifiedAccounts", label: "E-poçt təsdiqi gözləyənlər", count: counts.unverifiedAccounts, href: "/admin/verification" },
  ];
  return items.filter((item) => item.count > 0);
}

// ---------------------------------------------------------------------------------------------------------------
// Global admin search: term rules.
// ---------------------------------------------------------------------------------------------------------------

export const ADMIN_SEARCH_MIN_LENGTH = 2;
export const ADMIN_SEARCH_MAX_LENGTH = 120;
export const ADMIN_SEARCH_GROUP_LIMIT = 5;
/** In-process budget (no database write): per admin account and per trusted client IP, per minute. */
export const ADMIN_SEARCH_RATE_LIMIT = { limit: 60, windowMs: 60_000 } as const;

export type AdminSearchTerm =
  | { ok: true; term: string; like: string; orderFragment: string | null }
  | { ok: false; reason: "short" | "long" };

/**
 * Trims (lib/search-term), collapses inner spaces, requires 2-120 characters and escapes LIKE wildcards (Prisma
 * `contains` does not: "%" matched every row on 5433). `orderFragment` is set only when the term looks like an order
 * number (letters/digits, at least 6, optional "#"), so order ids are not scanned for ordinary words.
 */
export function parseAdminSearchTerm(raw: string | null | undefined): AdminSearchTerm {
  const normalized = normalizePublicSearchTerm(raw?.replace(/\s+/g, " "), ADMIN_SEARCH_MAX_LENGTH);
  if (normalized.tooLong) return { ok: false, reason: "long" };
  const term = normalized.value ?? "";
  if (term.length < ADMIN_SEARCH_MIN_LENGTH) return { ok: false, reason: "short" };
  const order = /^#?([a-z0-9]{6,40})$/i.exec(term);
  return { ok: true, term, like: escapeLikePattern(term), orderFragment: order ? order[1].toLowerCase() : null };
}

// ---------------------------------------------------------------------------------------------------------------
// Admin list CSV exports.
// ---------------------------------------------------------------------------------------------------------------

/** UTF-8 byte order mark, so Excel reads the file as UTF-8. */
export const CSV_BOM = String.fromCharCode(0xfeff);
export const ADMIN_LIST_EXPORT_MAX_ROWS = 5000;
export const ADMIN_LIST_EXPORT_ACTION = "ADMIN_LIST_EXPORT";
export const ADMIN_LIST_EXPORT_RATE_LIMIT = { limit: 10, windowMs: 60_000 } as const;
export const ADMIN_LIST_EXPORTS = ["stores", "orders", "customers", "seller-applications"] as const;
export type AdminListExport = (typeof ADMIN_LIST_EXPORTS)[number];

/**
 * CSV with a UTF-8 BOM (Excel shows Azerbaijani letters), CRLF lines and formula-safe cells: a text cell starting
 * with = + - @ (also after spaces or control characters), a tab or a carriage return gets a leading apostrophe
 * (lib/admin-report-csv.ts sanitizeCsvText).
 */
export function buildAdminListCsv(header: readonly string[], rows: readonly AdminReportCsvRow[]): string {
  return CSV_BOM + buildAdminReportCsv([header, ...rows]);
}

/** Keeps at most `max` rows; `truncated` tells whether more matched. */
export function capRows<T>(rows: readonly T[], max = ADMIN_LIST_EXPORT_MAX_ROWS): { rows: T[]; truncated: boolean } {
  return { rows: rows.slice(0, max), truncated: rows.length > max };
}
