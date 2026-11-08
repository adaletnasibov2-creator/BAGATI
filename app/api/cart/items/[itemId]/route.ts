import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolvePublicProductEligibility } from "@/lib/store-eligibility";
import { resolveVariantInventory } from "@/lib/product-variants";
const schema = z.object({ quantity: z.number().int().min(1).max(50) });
type Context = { params: Promise<{ itemId: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  const user = await requireRole("CUSTOMER");
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { itemId } = await params;
  let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(body); if (!parsed.success) return NextResponse.json({ error: "Quantity must be from 1 to 50" }, { status: 422 });
  try {
    const updated = await prisma.$transaction(async transaction => {
    const tx: any = transaction;
      const item = await tx.cartItem.findFirst({ where: { id: itemId, cart: { userId: user.id } }, include: { product: { select: { id: true, status: true, store: { select: { id: true } }, inventory: true, variants: { select: { id: true, productId: true, isActive: true } } } } } });
      if (!item) throw new Error("NOT_FOUND");
      const eligibleProductIds = await resolvePublicProductEligibility([{
        id: item.product.id,
        status: item.product.status,
        storeId: item.product.store.id,
      }], tx);
      if (!eligibleProductIds.has(item.product.id)) throw new Error("UNAVAILABLE");
      const resolved = resolveVariantInventory(item.productId, item.variantId, item.product.variants, item.product.inventory, parsed.data.quantity);
      const inventory = resolved.inventory;
      await tx.$queryRawUnsafe('SELECT "id" FROM "Inventory" WHERE "id" = $1 FOR UPDATE', inventory.id);
      const current = await tx.inventory.findUnique({ where: { id: inventory.id } });
      if (!current || current.quantity - current.reserved < parsed.data.quantity) throw new Error("VARIANT_OUT_OF_STOCK");
      return tx.cartItem.updateMany({ where: { id: item.id, cart: { userId: user.id } }, data: { quantity: parsed.data.quantity } });
    });
    return NextResponse.json({ item: updated });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ERROR";
    const errors: Record<string, string> = { NOT_FOUND: "Məhsul səbətdə tapılmadı.", UNAVAILABLE: "Məhsul artıq sifariş üçün açıq deyil.", VARIANT_REQUIRED: "Məhsul üçün variant seçin.", VARIANT_INVALID: "Seçilən variant bu məhsula aid deyil.", VARIANT_INACTIVE: "Seçilən variant artıq satışda deyil.", VARIANT_INVENTORY_MISSING: "Seçilən variant üçün stok məlumatı yoxdur.", VARIANT_OUT_OF_STOCK: "Stok dəyişib. Mövcud miqdarı yeniləyin." };
    return NextResponse.json({ error: errors[code] || "Səbət yenilənmədi." }, { status: code === "NOT_FOUND" ? 404 : code === "VARIANT_OUT_OF_STOCK" ? 409 : code in errors ? 422 : 500 });
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const user = await requireRole("CUSTOMER");
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { itemId } = await params;
  const result = await prisma.cartItem.deleteMany({ where: { id: itemId, cart: { userId: user.id } } });
  if (!result.count) return NextResponse.json({ error: "Məhsul səbətdə tapılmadı." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
