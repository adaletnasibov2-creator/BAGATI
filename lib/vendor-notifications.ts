/**
 * Seller notification helpers. The Notification table has no type or link column,
 * so the titles written by BAGATI code are the contract used to route a notification
 * to the right seller page. Unknown titles simply have no link.
 */
export const VENDOR_NOTIFICATION_TITLES = {
  newOrder: "Yeni sifariş",
  lowStock: "Anbar qalığı azalıb",
  outOfStock: "Məhsul stokda qalmayıb",
  newReturn: "Yeni qaytarılma sorğusu",
  returnCancelled: "Qaytarılma sorğusu ləğv edildi",
  storeApproved: "Mağaza təsdiqləndi",
  storeRejected: "Mağaza müraciəti rədd edildi",
  storeSuspended: "Mağaza dayandırıldı",
} as const;

/** Seller notification for an administrator's store review decision (audit action from lib/store-review). */
export function storeReviewNotification(auditAction: string, storeName: string, reason: string | null, activeForSale: boolean) {
  const why = reason?.trim() ? ` Səbəb: ${reason.trim()}` : "";
  switch (auditAction) {
    case "STORE_APPROVE":
    case "STORE_REACTIVATE":
      return {
        title: VENDOR_NOTIFICATION_TITLES.storeApproved,
        body: activeForSale
          ? `"${storeName}" mağazası təsdiqləndi və alıcılar üçün açıqdır.`
          : `"${storeName}" mağazası təsdiqləndi, lakin satış hələ açılmayıb. Çatışmayan addımları idarəetmə panelində yoxlayın.`,
      };
    case "STORE_REJECT":
      return { title: VENDOR_NOTIFICATION_TITLES.storeRejected, body: `"${storeName}" mağazasının müraciəti rədd edildi.${why} Məlumatları düzəldib yenidən göndərə bilərsiniz.` };
    case "STORE_SUSPEND":
      return { title: VENDOR_NOTIFICATION_TITLES.storeSuspended, body: `"${storeName}" mağazası dayandırıldı.${why}` };
    default:
      return null;
  }
}

const routes: [title: string, section: string][] = [
  [VENDOR_NOTIFICATION_TITLES.storeApproved, ""],
  [VENDOR_NOTIFICATION_TITLES.storeRejected, "profile"],
  [VENDOR_NOTIFICATION_TITLES.storeSuspended, "profile"],
  [VENDOR_NOTIFICATION_TITLES.newOrder, "orders"],
  [VENDOR_NOTIFICATION_TITLES.lowStock, "inventory"],
  [VENDOR_NOTIFICATION_TITLES.outOfStock, "inventory"],
  [VENDOR_NOTIFICATION_TITLES.newReturn, "returns"],
  [VENDOR_NOTIFICATION_TITLES.returnCancelled, "returns"],
];

/** Seller page for a notification, or null when the title is not a known seller event. */
export function vendorNotificationHref(storeId: string, title: string, storeScoped: boolean): string | null {
  if (!storeScoped) return null;
  const match = routes.find(([known]) => known === title);
  if (!match) return null;
  return `/vendor/${encodeURIComponent(storeId)}${match[1] ? `/${match[1]}` : ""}`;
}

/**
 * The only notifications a seller may read or mark as read in a store panel:
 * their own (userId), for this store or account-wide. Never another seller's,
 * never another store's. `id` narrows to one row inside that scope.
 */
export function vendorNotificationScope(userId: string, storeId: string, extra: { id?: string; unreadOnly?: boolean } = {}) {
  if (!userId || !storeId) throw new Error("VENDOR_SCOPE_REQUIRED");
  return {
    userId,
    OR: [{ storeId }, { storeId: null }],
    ...(extra.unreadOnly ? { readAt: null } : {}),
    ...(extra.id ? { id: extra.id } : {}),
  };
}

export type StockLevel = "OK" | "LOW" | "OUT";

export function stockLevel(available: number, lowStockThreshold: number): StockLevel {
  if (available <= 0) return "OUT";
  if (available <= lowStockThreshold) return "LOW";
  return "OK";
}

/**
 * Returns the level a stock row has just entered, or null when nothing new happened.
 * Alerts fire only on a downward crossing (OK→LOW, OK→OUT, LOW→OUT), so repeating
 * a sale at an already-low level never produces a duplicate notification.
 */
export function stockAlertCrossing(
  previousAvailable: number,
  nextAvailable: number,
  lowStockThreshold: number,
): Exclude<StockLevel, "OK"> | null {
  const rank: Record<StockLevel, number> = { OK: 0, LOW: 1, OUT: 2 };
  const before = stockLevel(previousAvailable, lowStockThreshold);
  const after = stockLevel(nextAvailable, lowStockThreshold);
  if (after === "OK" || rank[after] <= rank[before]) return null;
  return after;
}

export function stockAlertNotification(level: "LOW" | "OUT", productName: string, available: number) {
  return level === "OUT"
    ? { title: VENDOR_NOTIFICATION_TITLES.outOfStock, body: `"${productName}" məhsulunun anbar qalığı bitib. Satışı davam etdirmək üçün stoku yeniləyin.` }
    : { title: VENDOR_NOTIFICATION_TITLES.lowStock, body: `"${productName}" məhsulundan ${available} ədəd qalıb.` };
}
