import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolvePublicProductEligibility } from "@/lib/store-eligibility";
import { calculateVariantEffectivePrice, resolveVariantInventory } from "@/lib/product-variants";

export async function GET() {
  const user = await requireRole("CUSTOMER");
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const now = new Date();
  const cart = await prisma.cart.findUnique({
    where: { userId: user.id },
    include: { items: { include: {
      product: { include: {
        store: { select: { id: true, name: true, cityId: true } },
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
    let available = 0, variantPurchasable = false;
    try { const resolved = resolveVariantInventory(item.productId, item.variantId, item.product.variants, item.product.inventory, item.quantity); available = resolved.available; variantPurchasable = true; }
    catch { const row = item.product.inventory.find((candidate: any) => candidate.variantId === item.variantId); available = row ? Math.max(0, row.quantity - row.reserved) : 0; }
    const effective = calculateVariantEffectivePrice({ productPrice: item.product.price, productDiscountPrice: item.product.discountPrice, variant: item.variant, promotions: item.product.promotionProducts, storeId: item.product.store.id, now });
    const regular = Number(item.variant?.price ?? item.product.price);
    const priceValid = Number.isFinite(regular) && regular > 0 && effective.unitPrice.gt(0) && effective.unitPrice.lte(effective.basePrice);
    const purchasable = eligibleProductIds.has(item.productId) && variantPurchasable && priceValid;
    const customerProduct = { ...item.product };
    delete customerProduct.sku;
    const customerVariant = item.variant ? { ...item.variant } : null;
    if (customerVariant) delete customerVariant.sku;
    return { ...item, product: customerProduct, variant: customerVariant, available, effectivePrice: effective.unitPrice.toFixed(2), effectiveBasePrice: effective.basePrice.toFixed(2), effectiveDiscount: effective.discountAmount.toFixed(2), activePromotionName: effective.promotion?.name || null, purchasable, unavailableReason: !eligibleProductIds.has(item.productId) ? "Mağaza və ya məhsul əlçatan deyil" : !variantPurchasable ? "Seçilən variant artıq əlçatan deyil" : !priceValid ? "Məhsul qiymətini yoxlamaq lazımdır" : null };
  }) } });
}
