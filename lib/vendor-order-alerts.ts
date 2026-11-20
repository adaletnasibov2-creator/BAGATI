/**
 * Pure helpers for the seller panel's new-order alerts (SELLER-ALERTS, part C). Shared by the API route and tests.
 */

/** Polling: every 30 s while the tab is visible, every 120 s while hidden; errors back off up to 10 minutes. */
export const ORDER_ALERTS_VISIBLE_MS = 30_000;
export const ORDER_ALERTS_HIDDEN_MS = 120_000;
export const ORDER_ALERTS_MAX_BACKOFF_MS = 600_000;
/** The query never looks further back than this, whatever `after` says (bounds the work of one request). */
export const ORDER_ALERTS_MAX_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/** A valid ISO time, clamped to [now - 7 days, now]; null for anything else (no query then). */
export function parseOrderAlertsAfter(raw: string | null, now: Date): Date | null {
  if (!raw || raw.length > 40) return null;
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) return null;
  const clamped = Math.min(Math.max(time, now.getTime() - ORDER_ALERTS_MAX_LOOKBACK_MS), now.getTime());
  return new Date(clamped);
}

/** Next wait: the normal interval for the tab state, doubled per consecutive error, capped at 10 minutes. */
export function nextOrderAlertsDelay(input: { hidden: boolean; errors: number }): number {
  const base = input.hidden ? ORDER_ALERTS_HIDDEN_MS : ORDER_ALERTS_VISIBLE_MS;
  return input.errors > 0 ? Math.min(base * 2 ** Math.min(input.errors, 10), ORDER_ALERTS_MAX_BACKOFF_MS) : base;
}

/** "(3) Sifarişlər" while there are new orders; the plain title otherwise. Never stacks prefixes. */
export function titleWithOrderCount(title: string, count: number): string {
  const plain = title.replace(/^\(\d+\+?\)\s/, "");
  return count > 0 ? `(${count > 99 ? "99+" : count}) ${plain}` : plain;
}

/** The seller opened the orders list or an order: the alert is seen. */
export function isOrdersPath(pathname: string, storeId: string): boolean {
  const base = `/vendor/${storeId}/orders`;
  return pathname === base || pathname.startsWith(`${base}/`);
}
