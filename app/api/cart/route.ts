import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolvePublicProductEligibility } from "@/lib/store-eligibility";
import { calculateVariantEffectivePrice } from "@/lib/product-variants";
import { cartItemAvailability } from "@/lib/cart-item-availability";

export async function GET() {
  const user = await requireRole("CUSTOMER");
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const now = new Date();
  const cart = await prisma.cart.findUnique({
    where: { userId: user.id },
    include: { items: { include: {
      product: { include: {
        // CART-DELIVERY: the two delivery settings, so the cart shows the same delivery as the checkout (read-only).
        store: { select: { id: true, name: true, cityId: true, deliveryFee: true, freeDeliveryThreshold: true } },
        inventory: true,
        variants: { select: { id: true, productId: true, isActive: true } },
        promotionProducts: { where: { promotion: { isActive: true, startsAt: { lte: now }, endsAt: { gte: now } } }, include: { promotion: true } },
      } },
      variant: true,
    } } },
  });
  if (!cart) return NextResponse.json({ cart: null });
  const eligibleProductIds = await resolvePublicProductEligibility(cart.items.map((item: any) => item.product));
  return NextResponse.json({ cart: { ...cart, items: cart.items.map((item: any) => {
    const effective = calculateVariantEffectivePrice({ productPrice: item.product.price, productDiscountPrice: item.product.discountPrice, variant: item.variant, promotions: item.product.promotionProducts, storeId: item.product.store.id, now });
    const regular = Number(item.variant?.price ?? item.product.price);
    const priceValid = Number.isFinite(regular) && regular > 0 && effective.unitPrice.gt(0) && effective.unitPrice.lte(effective.basePrice);
    const { available, purchasable, unavailableReason } = cartItemAvailability({ productId: item.productId, variantId: item.variantId, variants: item.product.variants, inventory: item.product.inventory, quantity: item.quantity, eligible: eligibleProductIds.has(item.productId), priceValid });
    const customerProduct = { ...item.product, store: { ...item.product.store, deliveryFee: item.product.store.deliveryFee.toFixed(2), freeDeliveryThreshold: item.product.store.freeDeliveryThreshold.toFixed(2) } };
    delete customerProduct.sku;
    const customerVariant = item.variant ? { ...item.variant } : null;
    if (customerVariant) delete customerVariant.sku;
    return { ...item, product: customerProduct, variant: customerVariant, available, effectivePrice: effective.unitPrice.toFixed(2), effectiveBasePrice: effective.basePrice.toFixed(2), effectiveDiscount: effective.discountAmount.toFixed(2), activePromotionName: effective.promotion?.name || null, purchasable, unavailableReason };
  }) } });
}
