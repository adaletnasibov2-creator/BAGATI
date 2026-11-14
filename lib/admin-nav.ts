/**
 * Admin navigation: groups, items and the routes deliberately left out of the menu. Used by components/admin-shell.tsx
 * and unit-tested (every item points to an existing admin route; stubs are hidden).
 *
 * Groups as agreed for Phase B. Pages that were not in the requested list were placed in the closest group
 * (Qaytarılma sorğuları, Hesabatlar → Satış; Satıcılar → Mağazalar; Kampaniyalar → Məzmun; E-poçt çatdırılması,
 * Sistem vəziyyəti, Aktiv sessiyalar → Sistem). "Bannerlər" and "Ana səhifə" are one page (/admin/homepage).
 */
import {
  Activity, BadgePercent, Bell, FileText, ChartNoAxesCombined, ClipboardCheck, CreditCard, FileClock, Images, LayoutDashboard,
  LifeBuoy, MailCheck, Map, MonitorSmartphone, Package, Percent, RotateCcw, Send, Settings, ShieldCheck, ShoppingBag,
  Star, Store, Tags, Upload, UserRound, Users, type LucideIcon,
} from "lucide-react";

export type AdminNavItem = readonly [href: string, label: string, icon: LucideIcon];
export type AdminNavGroup = { id: string; label: string; items: readonly AdminNavItem[] };

export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    id: "sales", label: "Satış", items: [
      ["/admin", "İcmal", LayoutDashboard],
      ["/admin/orders", "Sifarişlər", ShoppingBag],
      ["/admin/customers", "Müştərilər", UserRound],
      ["/admin/verification", "E-poçt təsdiqi gözləyənlər", MailCheck],
      ["/admin/returns", "Qaytarılma sorğuları", RotateCcw],
      ["/admin/reports", "Hesabatlar", ChartNoAxesCombined],
    ],
  },
  {
    id: "catalog", label: "Kataloq", items: [
      ["/admin/products", "Məhsullar", Package],
      ["/admin/categories", "Kateqoriyalar", Tags],
      ["/admin/brands", "Brendlər", BadgePercent],
    ],
  },
  {
    id: "stores", label: "Mağazalar", items: [
      ["/admin/stores", "Mağazalar", Store],
      ["/admin/vendors", "Satıcılar", Users],
      ["/admin/seller-applications", "Satıcı müraciətləri", ClipboardCheck],
      ["/admin/subscriptions", "Abunəliklər", CreditCard],
      ["/admin/commissions", "Komissiyalar", Percent],
      ["/admin/cities", "Şəhərlər", Map],
    ],
  },
  {
    id: "content", label: "Məzmun", items: [
      ["/admin/homepage", "Ana səhifə və bannerlər", Images],
      ["/admin/pages", "Səhifələr", FileText],
      ["/admin/promotions", "Kampaniyalar", BadgePercent],
      ["/admin/reviews", "Rəylər", Star],
      ["/admin/support", "Dəstək", LifeBuoy],
    ],
  },
  {
    id: "system", label: "Sistem", items: [
      ["/admin/settings", "Sayt parametrləri", Settings],
      ["/admin/security-center", "Təhlükəsizlik mərkəzi", ShieldCheck],
      ["/admin/security", "Hesab təhlükəsizliyi", ShieldCheck],
      ["/admin/security/sessions", "Aktiv sessiyalar", MonitorSmartphone],
      ["/admin/audit-log", "Audit jurnalı", FileClock],
      ["/admin/imports", "İdxallar", Upload],
      ["/admin/notifications", "Bildirişlər", Bell],
      ["/admin/email", "E-poçt çatdırılması", Send],
      ["/admin/system", "Sistem vəziyyəti", Activity],
    ],
  },
];

/** Routes that still work but are not in the menu: information-only stubs until payments are built. */
export const ADMIN_HIDDEN_ROUTES = ["/admin/payments", "/admin/refunds"] as const;

/** The most specific menu item for a path (e.g. /admin/security/sessions, not also /admin/security). */
export function activeAdminNavHref(path: string): string | undefined {
  return ADMIN_NAV_GROUPS.flatMap((group) => group.items.map(([href]) => href))
    .filter((href) => path === href || (href !== "/admin" && path.startsWith(`${href}/`)))
    .sort((a, b) => b.length - a.length)[0];
}

/** Group that holds the active item (opened by default). */
export function activeAdminNavGroup(path: string): string | undefined {
  const href = activeAdminNavHref(path);
  return href ? ADMIN_NAV_GROUPS.find((group) => group.items.some(([itemHref]) => itemHref === href))?.id : undefined;
}
