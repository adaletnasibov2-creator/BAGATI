/**
 * ADMIN-POWER-1: the admin files this task changed or added. Older "admin untouched" pins allow exactly these (plus
 * ADMIN-DESIGN-1's list) and nothing else. Admin API routes stay protected except the two new routes, which are
 * listed explicitly and tested in scripts/admin-power-1.test.ts (ADMIN only, rate limited, bounded, escaped).
 */
import { ADMIN_DESIGN_1_FILES } from "./admin-design-1-scope";

export const ADMIN_POWER_1_API_ROUTES = ["app/api/admin/search/route.ts", "app/api/admin/list-export/[list]/route.ts"] as const;

export const ADMIN_POWER_1_FILES: ReadonlySet<string> = new Set([
  "app/admin/page.tsx",
  "app/admin/_sections/shared.tsx",
  "app/admin/_sections/stores.tsx",
  "app/admin/_sections/products.tsx",
  "app/admin/_sections/orders.tsx",
  "app/admin/_sections/customers.tsx",
  "app/admin/_sections/store-detail.tsx",
  "app/admin/_sections/order-detail.tsx",
  "app/admin/_sections/customer-detail.tsx",
  "app/admin/_sections/vendor-detail.tsx",
  "app/admin/seller-applications/page.tsx",
  "app/admin/seller-applications/[id]/page.tsx",
  "components/admin-shell.tsx",
  "components/admin-verification-summary.tsx",
  "components/admin-activity-chart.tsx",
  "components/admin-attention-queue.tsx",
  "components/admin-global-search.tsx",
  "components/admin-list-toolbar.tsx",
  "components/admin-theme.tsx",
  "components/admin-ui/detail-header.tsx",
  ...ADMIN_POWER_1_API_ROUTES,
]);

/** Files an older pin may see as changed: this task's and ADMIN-DESIGN-1's. */
export function isAllowedAdminChange(path: string): boolean {
  return ADMIN_POWER_1_FILES.has(path) || ADMIN_DESIGN_1_FILES.has(path);
}

/** A `git diff --name-only` output without the allowed admin files (empty when nothing else changed). */
export function withoutAllowedAdminChanges(diff: string): string {
  return diff.split(/\r?\n/).filter((path) => path && !isAllowedAdminChange(path)).join("\n");
}
