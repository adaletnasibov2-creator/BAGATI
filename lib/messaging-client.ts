/**
 * Client-safe messaging helpers (no database, no server imports): page links and the polling schedule.
 *
 * Polling (owner spec, phase 5): every 15 s while the tab is visible; after 5 minutes without anything new, every
 * 60 s; nothing while the tab is hidden (resumes with an immediate check when it becomes visible again); stopped for
 * good on 401 / 403 / 404 / 503 (signed out, messaging switched off or blocked, thread gone, service down).
 */
export const MESSAGE_POLL = {
  fastMs: 15_000,
  slowMs: 60_000,
  quietAfterMs: 5 * 60_000,
  stopStatuses: [401, 403, 404, 503] as readonly number[],
} as const;

/** Delay before the next check: fast until 5 quiet minutes have passed since the last news (or since opening). */
export function nextPollDelay(lastNewsAt: number, now: number): number {
  return now - lastNewsAt >= MESSAGE_POLL.quietAfterMs ? MESSAGE_POLL.slowMs : MESSAGE_POLL.fastMs;
}

export function isStopPollStatus(status: number): boolean {
  return MESSAGE_POLL.stopStatuses.includes(status);
}

/** Customer-facing notice for a stopped poll. */
export function pollStopMessage(status: number): string {
  if (status === 401) return "Sessiyanın müddəti bitib. Yenidən daxil olun.";
  if (status === 404) return "Söhbət tapılmadı.";
  if (status === 403) return "Mesajlaşma hazırda əlçatan deyil.";
  return "Yeni mesajlar hazırda yüklənmir. Səhifəni bir az sonra yeniləyin.";
}

const enc = encodeURIComponent;
export const customerInboxHref = "/account/messages";
export const customerThreadHref = (conversationId: string) => `/account/messages/${enc(conversationId)}`;
export const storeInboxHref = (storeId: string) => `/vendor/${enc(storeId)}/messages`;
export const storeThreadHref = (storeId: string, conversationId: string) => `/vendor/${enc(storeId)}/messages/${enc(conversationId)}`;
export const customerMessagesApi = "/api/account/messages";
export const customerThreadApi = (conversationId: string) => `/api/account/messages/${enc(conversationId)}`;
export const storeThreadApi = (storeId: string, conversationId: string) => `/api/vendor/${enc(storeId)}/messages/${enc(conversationId)}`;

/** "Write to the store" page for a product, one of the customer's store orders, or the store in general. */
export function newConversationHref(input: { storeId: string; productId?: string | null; storeOrderId?: string | null }): string {
  const params = new URLSearchParams({ store: input.storeId });
  if (input.productId) params.set("product", input.productId);
  else if (input.storeOrderId) params.set("order", input.storeOrderId);
  return `/account/messages/new?${params.toString()}`;
}

/** Logged-out visitor: sign in first, then come back to the same page. */
export const loginThenHref = (next: string) => `/login?next=${enc(next)}`;

/**
 * Timestamp in Baku time as "16.11.2026, 22:41". Built from numeric parts only, so the server (Node ICU) and the
 * browser render the same text (named Azerbaijani months differ between ICU builds: "noy" vs "M11").
 */
const timeParts = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Baku" });
export function formatMessageTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const part = Object.fromEntries(timeParts.formatToParts(date).map((item) => [item.type, item.value]));
  return `${part.day}.${part.month}.${part.year}, ${part.hour}:${part.minute}`;
}

/**
 * Where a "write to the store" button leads, or null when it is hidden: a customer goes to the new-message page; a
 * logged-out visitor is sent to sign in first only when `loggedOut` is "login" (the store page keeps its anonymous
 * form instead); sellers and admins see no button.
 */
export function messageEntryHref(
  viewerRole: "CUSTOMER" | "VENDOR" | "ADMIN" | null,
  target: { storeId: string; productId?: string | null; storeOrderId?: string | null },
  loggedOut: "login" | "hide",
): string | null {
  if (viewerRole === "CUSTOMER") return newConversationHref(target);
  if (viewerRole === null && loggedOut === "login") return loginThenHref(newConversationHref(target));
  return null;
}
