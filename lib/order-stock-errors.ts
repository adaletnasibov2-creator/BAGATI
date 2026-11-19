/**
 * POST /api/orders stock errors (SCALE-FIX-1 A7). Browser-safe: imported by the route and by the checkout form.
 * resolveVariantInventory (lib/product-variants.ts) throws these; they returned HTTP 500 before and are 409 now, like
 * the other cart problems. Wording follows the cart APIs (app/api/cart/items).
 */
export const ORDER_STOCK_ERROR_MESSAGES: Record<string, string> = {
  VARIANT_OUT_OF_STOCK: "Məhsul bitib və ya səbətdəki miqdar qədər qalmayıb. Səbəti yeniləyin.",
  VARIANT_REQUIRED: "Səbətdəki məhsul üçün variant seçin. Səbəti yeniləyin.",
  VARIANT_INACTIVE: "Seçilən variant artıq satışda deyil. Səbəti yeniləyin.",
  VARIANT_INVENTORY_MISSING: "Seçilən variant üçün stok məlumatı yoxdur. Səbəti yeniləyin.",
};

/** Codes after which the checkout form refreshes the cart data and offers a link to the cart. */
export const ORDER_STOCK_ERROR_CODES = ["STOCK_CHANGED", ...Object.keys(ORDER_STOCK_ERROR_MESSAGES)];
