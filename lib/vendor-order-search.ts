/**
 * Builds the seller order search filter. The result is always combined with the
 * server-side `storeId` condition by the caller, so a search can never widen access.
 * Sellers type the short reference they see ("#A1B2C3D4") or a product name.
 */
export function parseVendorOrderSearch(raw: string | null | undefined) {
  const term = (raw ?? "").trim().replace(/^#/, "").slice(0, 80);
  if (term.length < 2) return null;
  const contains = { contains: term, mode: "insensitive" as const };
  return {
    OR: [
      { order: { id: contains } },
      { id: contains },
      { items: { some: { productName: contains } } },
    ],
  };
}

/** Seller order filter. `storeId` is server-derived and always a top-level condition. */
export function vendorOrderWhere(storeId: string, status: string | null, rawSearch: string | null) {
  if (!storeId) throw new Error("VENDOR_SCOPE_REQUIRED");
  const search = parseVendorOrderSearch(rawSearch);
  return { storeId, ...(status ? { status } : {}), ...(search ? { AND: [search] } : {}) };
}

const SELLER_PAYMENT_LABELS: Record<string, string> = {
  PENDING: "Ödəniş gözləyir",
  AUTHORIZED: "Ödəniş təsdiqlənib",
  PAID: "Ödənilib",
  FAILED: "Ödəniş alınmadı",
  REFUNDED: "Geri ödənilib",
};

/** Most decisive payment state across a parent order's payment attempts. */
export function summarizePaymentStatus(statuses: readonly string[]): { status: string | null; label: string } {
  const order = ["REFUNDED", "PAID", "AUTHORIZED", "PENDING", "FAILED"];
  const status = order.find((candidate) => statuses.includes(candidate)) ?? null;
  return { status, label: status ? SELLER_PAYMENT_LABELS[status] : "Ödəniş qeydi yoxdur" };
}
