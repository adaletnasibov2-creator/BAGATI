import { resolveVariantInventory, type PurchasableVariant, type VariantInventory } from "@/lib/product-variants";

/**
 * Whether one cart line can be ordered, and the short reason shown under it when not (CART-DELIVERY). Used by
 * GET /api/cart and by the checkout page, so both show the same notes. Order creation (POST /api/orders) is not
 * changed: it still calls resolveVariantInventory itself and refuses with its own error codes.
 *
 * resolveVariantInventory throws VARIANT_OUT_OF_STOCK for any product (with or without variants) whose stock is
 * below the cart quantity; only that case is "Stokda yoxdur". Real variant problems (missing, inactive or required
 * variant, no inventory row) keep "Seçilən variant artıq əlçatan deyil".
 */
export const CART_UNAVAILABLE_REASONS = {
  storeOrProduct: "Mağaza və ya məhsul əlçatan deyil",
  outOfStock: "Stokda yoxdur",
  variant: "Seçilən variant artıq əlçatan deyil",
  price: "Məhsul qiymətini yoxlamaq lazımdır",
} as const;

export function cartItemAvailability(input: {
  productId: string;
  variantId: string | null;
  variants: PurchasableVariant[];
  inventory: VariantInventory[];
  quantity: number;
  /** The product and its store are publicly eligible (resolvePublicProductEligibility). */
  eligible: boolean;
  priceValid: boolean;
}): { available: number; purchasable: boolean; unavailableReason: string | null } {
  let available = 0, variantPurchasable = false, outOfStock = false;
  try {
    available = resolveVariantInventory(input.productId, input.variantId, input.variants, input.inventory, input.quantity).available;
    variantPurchasable = true;
  } catch (error) {
    const row = input.inventory.find((candidate) => candidate.variantId === input.variantId);
    available = row ? Math.max(0, row.quantity - row.reserved) : 0;
    outOfStock = error instanceof Error && error.message === "VARIANT_OUT_OF_STOCK";
  }
  const purchasable = input.eligible && variantPurchasable && input.priceValid;
  const unavailableReason = !input.eligible ? CART_UNAVAILABLE_REASONS.storeOrProduct
    : outOfStock ? CART_UNAVAILABLE_REASONS.outOfStock
    : !variantPurchasable ? CART_UNAVAILABLE_REASONS.variant
    : !input.priceValid ? CART_UNAVAILABLE_REASONS.price
    : null;
  return { available, purchasable, unavailableReason };
}
