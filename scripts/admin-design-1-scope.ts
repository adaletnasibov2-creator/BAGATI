/**
 * ADMIN-DESIGN-1 (visual only): the admin UI files this task restyled. Older "admin untouched" pins
 * (security-audit-1, order-notify-1, design-polish-2, seller-panel-3, seo-titles-1) allow exactly these files and
 * nothing else: admin API routes (app/api/admin/**), every other admin page and component, the legal pages and
 * lib/legal stay protected. scripts/admin-design-1.test.ts pins that these files changed only class names and layout.
 */
export const ADMIN_DESIGN_1_FILES: ReadonlySet<string> = new Set([
  "app/admin/page.tsx",
  "app/admin/_sections/shared.tsx",
  "app/admin/_sections/stores.tsx",
  "app/admin/_sections/products.tsx",
  "app/admin/_sections/orders.tsx",
  "app/admin/_sections/customers.tsx",
  "app/admin/seller-applications/page.tsx",
  "components/admin-shell.tsx",
  "components/admin-list-filters.tsx",
  "components/admin-mutation-form.tsx",
  "components/admin-store-activation-action.tsx",
  "components/admin-verification-summary.tsx",
  "components/admin-ui/data-table.tsx",
  "components/admin-ui/empty-state.tsx",
  "components/admin-ui/form-field.tsx",
  "components/admin-ui/page-header.tsx",
  "components/admin-ui/result-message.tsx",
  "components/admin-ui/section.tsx",
  "components/admin-ui/stat-card.tsx",
  "components/admin-ui/status-badge.tsx",
  "components/admin-ui/styles.ts",
]);

/** A `git diff --name-only` output without this task's admin UI files (empty when nothing else changed). */
export function withoutAdminDesign1(diff: string): string {
  return diff.split(/\r?\n/).filter((path) => path && !ADMIN_DESIGN_1_FILES.has(path)).join("\n");
}
