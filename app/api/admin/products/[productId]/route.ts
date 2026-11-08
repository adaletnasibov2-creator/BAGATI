import { NextRequest, NextResponse } from "next/server";
import { csrfRejection } from "@/lib/csrf";
import { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { adminProductUpdateSchema, inventoryQuantityAllowed } from "@/lib/admin-product-management";
import { isOwnedStoreAssetUrl } from "@/lib/storage/store-assets";
import { findExistingProductSkuMatches, findExistingVariantSkuKeys } from "@/lib/catalog-import-persistence";
import { hasDuplicateNormalizedSkus } from "@/lib/sku-normalization";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ productId: string }> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Məhsul məlumatı yanlışdır" }, { status: 400 }); }
  const parsed = adminProductUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Məhsul məlumatlarını yoxlayın", details: parsed.error.flatten() }, { status: 422 });
  const { productId } = await params;
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { variants: { include: { inventory: true } }, inventory: { where: { variantId: null } } },
  });
  if (!product) return NextResponse.json({ error: "Məhsul tapılmadı" }, { status: 404 });

  const values = parsed.data;
  if (values.categoryId && !await prisma.category.findFirst({ where: { id: values.categoryId, isActive: true }, select: { id: true } })) {
    return NextResponse.json({ error: "Aktiv kateqoriya tapılmadı" }, { status: 422 });
  }
  if (values.brandId && !await prisma.brand.findUnique({ where: { id: values.brandId }, select: { id: true } })) {
    return NextResponse.json({ error: "Brend tapılmadı" }, { status: 422 });
  }
  if (values.images.some((url) => !isOwnedStoreAssetUrl(product.storeId, url) && !product.images.includes(url))) {
    return NextResponse.json({ error: "Məhsul şəkilləri həmin mağazanın yüklənmiş resurslarından seçilməlidir" }, { status: 422 });
  }
  const currentVariants = new Map(product.variants.map((variant) => [variant.id, variant]));
  if (hasDuplicateNormalizedSkus(values.variants.map((variant) => variant.sku))) {
    return NextResponse.json({ error: "Variant SKU-ləri təkrarlana bilməz" }, { status: 409 });
  }
  if (values.variants.length !== currentVariants.size || values.variants.some((variant) => !currentVariants.has(variant.id))) {
    return NextResponse.json({ error: "Variant siyahısı dəyişdirilib; yenidən yükləyin və mövcud variantları saxlayın" }, { status: 409 });
  }
  for (const variant of values.variants) {
    const current = currentVariants.get(variant.id)!;
    const stock = current.inventory.find((row) => row.variantId === current.id);
    if (stock && !inventoryQuantityAllowed(variant.quantity, stock.reserved)) {
      return NextResponse.json({ error: "Variant stoku rezerv edilmiş saydan aşağı ola bilməz" }, { status: 422 });
    }
  }
  const regularStock = product.inventory[0];
  if (regularStock && !inventoryQuantityAllowed(values.quantity, regularStock.reserved)) {
    return NextResponse.json({ error: "Stok rezerv edilmiş saydan aşağı ola bilməz" }, { status: 422 });
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      if (values.sku && (await findExistingProductSkuMatches(tx, product.storeId, [values.sku], product.id)).length) {
        return { skuConflict: true as const };
      }
      const variantSkus = values.variants.flatMap((variant) => variant.sku ? [variant.sku] : []);
      if (variantSkus.length) {
        const existingVariantSkus = await findExistingVariantSkuKeys(tx, variantSkus, [...currentVariants.keys()]);
        if (variantSkus.some((sku) => existingVariantSkus.has(sku))) return { skuConflict: true as const };
      }
      const saved = await tx.product.update({
        where: { id: product.id },
        data: {
          name: values.name,
          description: values.description,
          sku: values.sku,
          categoryId: values.categoryId,
          brandId: values.brandId,
          price: new Prisma.Decimal(values.price),
          discountPrice: values.discountPrice === null ? null : new Prisma.Decimal(values.discountPrice),
          images: values.images,
        },
      });
      const adjustStock = async (inventoryId: string, oldQuantity: number, newQuantity: number, lowStockThreshold: number) => {
        if (oldQuantity === newQuantity) {
          await tx.inventory.update({ where: { id: inventoryId }, data: { lowStockThreshold } });
          return;
        }
        const changed = await tx.inventory.updateMany({
          where: { id: inventoryId, quantity: oldQuantity, reserved: { lte: newQuantity } },
          data: { quantity: newQuantity, lowStockThreshold },
        });
        if (changed.count !== 1) throw new Error("STOCK_CHANGED");
        await tx.inventoryAdjustment.create({
          data: { inventoryId, actorUserId: admin.id, delta: newQuantity - oldQuantity, previousQuantity: oldQuantity, newQuantity, reason: "Admin məhsul redaktəsi" },
        });
      };
      if (regularStock) {
        await adjustStock(regularStock.id, regularStock.quantity, values.quantity, values.lowStockThreshold);
      } else if (!values.variants.length) {
        const createdStock = await tx.inventory.create({ data: { productId: product.id, quantity: values.quantity, lowStockThreshold: values.lowStockThreshold } });
        if (values.quantity > 0) await tx.inventoryAdjustment.create({
          data: { inventoryId: createdStock.id, actorUserId: admin.id, delta: values.quantity, previousQuantity: 0, newQuantity: values.quantity, reason: "Admin məhsul stoku ilkin təyin edildi" },
        });
      }
      for (const variant of values.variants) {
        const current = currentVariants.get(variant.id)!;
        await tx.productVariant.update({
          where: { id: current.id },
          data: {
            name: variant.name,
            sku: variant.sku,
            isActive: variant.isActive,
            price: variant.price === null ? null : new Prisma.Decimal(variant.price),
            discountPrice: variant.discountPrice === null ? null : new Prisma.Decimal(variant.discountPrice),
          },
        });
        const stock = current.inventory.find((row) => row.variantId === current.id);
        if (stock) await adjustStock(stock.id, stock.quantity, variant.quantity, variant.lowStockThreshold);
        else {
          const createdStock = await tx.inventory.create({ data: { productId: product.id, variantId: current.id, quantity: variant.quantity, lowStockThreshold: variant.lowStockThreshold } });
          if (variant.quantity > 0) await tx.inventoryAdjustment.create({
            data: { inventoryId: createdStock.id, actorUserId: admin.id, delta: variant.quantity, previousQuantity: 0, newQuantity: variant.quantity, reason: "Admin variant stoku ilkin təyin edildi" },
          });
        }
      }
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "ADMIN_PRODUCT_UPDATE",
          entityType: "Product",
          entityId: product.id,
          metadata: { changedFields: Object.keys(values), variantCount: values.variants.length },
        },
      });
      return saved;
    });
    if ("skuConflict" in updated) return NextResponse.json({ error: "Məhsul və ya variant SKU-su həmin unikal sahədə artıq istifadə olunur" }, { status: 409 });
    return NextResponse.json({ item: updated, message: "Məhsul məlumatları yadda saxlanıldı." });
  } catch (error) {
    if (error instanceof Error && error.message === "STOCK_CHANGED") {
      return NextResponse.json({ error: "Stok eyni vaxtda dəyişib. Səhifəni yeniləyin və təkrar yoxlayın." }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "SKU başqa məhsulda istifadə olunur" }, { status: 409 });
    }
    throw error;
  }
}
