import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolvePublicProductEligibility } from "@/lib/store-eligibility";
import { resolveVariantInventory } from "@/lib/product-variants";
const schema = z.object({ productId: z.string().min(1), variantId: z.string().min(1).optional(), quantity: z.number().int().min(1).max(50) });
export async function POST(request: NextRequest) {
  const user = await requireRole("CUSTOMER");
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  let raw: unknown; try { raw = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(raw); if (!parsed.success) return NextResponse.json({ error: "Review the product and quantity" }, { status: 422 });
  try {
    const item = await prisma.$transaction(async transaction => {
    const tx: any = transaction;
      const product = await tx.product.findUnique({ where: { id: parsed.data.productId }, include: { inventory: true, variants: { select: { id: true, productId: true, isActive: true } } } });
      if (!product) throw new Error("PRODUCT_UNAVAILABLE");
      const eligibleProductIds = await resolvePublicProductEligibility([product], tx);
      if (!eligibleProductIds.has(product.id)) throw new Error("PRODUCT_UNAVAILABLE");
      const variantId = parsed.data.variantId ?? null;
      const selected = resolveVariantInventory(product.id, variantId, product.variants, product.inventory, parsed.data.quantity);
      const inventory = selected.inventory;
      const regular = Number(product.price), discount = product.discountPrice === null ? null : Number(product.discountPrice);
      if (!Number.isFinite(regular) || regular <= 0 || (discount !== null && (!Number.isFinite(discount) || discount <= 0 || discount >= regular))) throw new Error("PRICE_INVALID");
      await tx.$queryRawUnsafe('SELECT "id" FROM "Inventory" WHERE "id" = $1 FOR UPDATE', inventory.id);
      const current = await tx.inventory.findUnique({ where: { id: inventory.id } });
      if (!current || current.quantity - current.reserved < parsed.data.quantity) throw new Error("VARIANT_OUT_OF_STOCK");
      const cart = await tx.cart.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
      const existing = await tx.cartItem.findFirst({ where: { cartId: cart.id, productId: product.id, variantId } });
      const wanted = parsed.data.quantity + (existing?.quantity ?? 0);
      if (wanted > current.quantity - current.reserved) throw new Error("VARIANT_OUT_OF_STOCK");
      return existing ? tx.cartItem.update({ where: { id: existing.id }, data: { quantity: wanted } }) : tx.cartItem.create({ data: { cartId: cart.id, productId: product.id, variantId, quantity: parsed.data.quantity } });
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ERROR";
    const messages: Record<string, string> = { PRODUCT_UNAVAILABLE: "Məhsul və ya mağaza artıq sifariş üçün açıq deyil.", VARIANT_REQUIRED: "Məhsul üçün variant seçin.", VARIANT_INVALID: "Seçilən variant bu məhsula aid deyil.", VARIANT_INACTIVE: "Seçilən variant artıq satışda deyil.", VARIANT_INVENTORY_MISSING: "Seçilən variant üçün stok məlumatı yoxdur.", VARIANT_OUT_OF_STOCK: "Seçilən variantdan kifayət qədər stok yoxdur.", PRICE_INVALID: "Məhsul qiymətində problem var." };
    return NextResponse.json({ error: messages[code] || "Məhsul səbətə əlavə edilmədi." }, { status: code === "VARIANT_OUT_OF_STOCK" ? 409 : code in messages ? 422 : 500 });
  }
}
