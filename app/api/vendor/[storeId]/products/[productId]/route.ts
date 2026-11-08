import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireStoreAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isOwnedStoreAssetUrl } from "@/lib/storage/store-assets";
import { EntitlementError, entitlementErrorResponse } from "@/lib/subscription-entitlements";
import { categoriesWithOtherLast } from "@/lib/category-order";
import { vendorProductPatchSchema, VendorProductPatchError, hasVendorProductStoreAccess, runVendorProductPatch } from "@/lib/vendor-product-patch";
import { isSkuUniqueViolation } from "@/lib/catalog-import-persistence";

const db = prisma;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ storeId: string; productId: string }> }) {
  const { storeId, productId } = await params;
  const access = await requireStoreAccess(storeId);
  if (!hasVendorProductStoreAccess(access)) return NextResponse.json({ error: "Mağazaya giriş icazəsi yoxdur" }, { status: 403 });
  const product = await db.product.findFirst({ where: { id: productId, storeId: access.storeId }, include: { category: true, brand: true, variants: { include: { inventory: true } }, inventory: true } });
  if (!product) return NextResponse.json({ error: "Məhsul tapılmadı" }, { status: 404 });
  const [categories, brands] = await Promise.all([
    db.category.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.brand.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return NextResponse.json({ product, categories: categoriesWithOtherLast(categories), brands });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ storeId: string; productId: string }> }) {
  const { storeId, productId } = await params;
  const access = await requireStoreAccess(storeId);
  if (!hasVendorProductStoreAccess(access)) return NextResponse.json({ error: "Mağazaya giriş icazəsi yoxdur" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Məhsul məlumatı yanlışdır" }, { status: 400 }); }

  const parsed = vendorProductPatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Məhsul məlumatlarını yoxlayın", details: parsed.error.flatten() }, { status: 422 });
  const values = parsed.data;
  if (values.variantsEnabled === false && values.variants === undefined) return NextResponse.json({ error: "Variant kombinasiyalarını göndərin" }, { status: 422 });
  if (values.variantsEnabled === false && (values.variants?.length ?? 0) > 0) return NextResponse.json({ error: "Variantlar söndürüldükdə kombinasiyaları göndərmək olmaz" }, { status: 422 });
  if (values.variantsEnabled && !values.variants?.length) return NextResponse.json({ error: "Variant xüsusiyyətləri və kombinasiyaları tələb olunur" }, { status: 422 });
  if ((values.variants || []).some((variant) => variant.discountPrice != null && variant.discountPrice >= (variant.price ?? values.price))) {
    return NextResponse.json({ error: "Variant endirimli qiyməti onun əsas qiymətindən aşağı olmalıdır" }, { status: 422 });
  }
  if (values.discountPrice !== null && values.discountPrice >= values.price) return NextResponse.json({ error: "Endirimli qiymət əsas qiymətdən aşağı olmalıdır" }, { status: 422 });
  if (values.categoryId && !await db.category.findFirst({ where: { id: values.categoryId, isActive: true }, select: { id: true } })) {
    return NextResponse.json({ error: "Kateqoriya tapılmadı" }, { status: 422 });
  }
  if (values.brandId && !await db.brand.findUnique({ where: { id: values.brandId }, select: { id: true } })) {
    return NextResponse.json({ error: "Brend tapılmadı" }, { status: 422 });
  }

  try {
    const product = await runVendorProductPatch(db, {
      storeId: access.storeId,
      productId,
      values,
      isOwnedImage: isOwnedStoreAssetUrl,
      actorUserId: access.user.id,
    });
    return NextResponse.json({ product });
  } catch (error) {
    if (error instanceof EntitlementError) return entitlementErrorResponse(error);
    if (error instanceof VendorProductPatchError) {
      if (error.code === "NOT_FOUND") return NextResponse.json({ error: "Məhsul tapılmadı" }, { status: 404 });
      if (error.code === "IMAGE_NOT_OWNED") return NextResponse.json({ error: "Yeni şəkilləri bu mağazanın yükləmə bölməsindən əlavə edin" }, { status: 422 });
      if (error.code === "VARIANT_NOT_OWNED") return NextResponse.json({ error: "Variant bu məhsula aid deyil" }, { status: 422 });
      if (error.code === "VARIANT_IMAGE_NOT_OWNED") return NextResponse.json({ error: "Variant şəkillərini bu mağazanın yükləmə bölməsindən əlavə edin" }, { status: 422 });
      if (error.code === "STOCK_BELOW_RESERVED") return NextResponse.json({ error: "Stok rezerv edilmiş miqdardan az ola bilməz" }, { status: 422 });
      if (error.code === "SKU_CONFLICT") return NextResponse.json({ error: "Məhsul və ya variant SKU-su artıq istifadə olunur" }, { status: 409 });
      if (error.code === "INVALID_VARIANT_OPTIONS") return NextResponse.json({ error: "Variant xüsusiyyətlərinin formatı yanlışdır" }, { status: 422 });
      if (error.code === "DUPLICATE_VARIANTS") return NextResponse.json({ error: "Variant kombinasiyaları təkrarlana bilməz" }, { status: 422 });
      if (error.code === "INVALID_VARIANT_DISCOUNT") return NextResponse.json({ error: "Variant endirimli qiyməti onun əsas qiymətindən aşağı olmalıdır" }, { status: 422 });
      if (error.code === "INVALID_DISCOUNT") return NextResponse.json({ error: "Endirimli qiymət əsas qiymətdən aşağı olmalıdır" }, { status: 422 });
      if (error.code === "PRODUCT_NOT_READY" && typeof error.details === "object" && error.details !== null && "blockers" in error.details) {
        return NextResponse.json({ error: "Məhsul yayımlanmağa hazır deyil", blockers: error.details.blockers }, { status: 422 });
      }
      if (error.code === "PRODUCT_LIMIT_REACHED" && typeof error.details === "object" && error.details !== null && "plan" in error.details) {
        const limit = error.details as { plan: "BASIC" | "PRO"; current: number; limit: number };
        return entitlementErrorResponse(new EntitlementError("PRODUCT_LIMIT_REACHED", limit.plan, limit.current, limit.limit));
      }
      if (error.code === "STORE_NOT_ELIGIBLE") {
        const blockers = typeof error.details === "object" && error.details !== null && "blockers" in error.details
          ? error.details.blockers
          : error.details;
        return NextResponse.json({ error: "Mağaza məhsul yayımlamaq üçün uyğun deyil", code: "STORE_NOT_ELIGIBLE", blockers }, { status: 409 });
      }
    }
    if (error && typeof error === "object" && "code" in error && error.code === "P2034") {
      return NextResponse.json({ error: "Məlumatlar paralel olaraq dəyişdirildi. Yenidən cəhd edin." }, { status: 409 });
    }
    if (isSkuUniqueViolation(error)) {
      return NextResponse.json({ error: "Bu SKU artıq istifadədədir. Başqa məhsul və ya variant kodu seçin." }, { status: 409 });
    }
    console.error("Vendor product update failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      code: error && typeof error === "object" && "code" in error ? String(error.code) : undefined,
    });
    return NextResponse.json({ error: "Məhsul yenilənə bilmədi" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ storeId: string; productId: string }> }) {
  const { storeId, productId } = await params;
  const access = await requireStoreAccess(storeId);
  if (!hasVendorProductStoreAccess(access)) return NextResponse.json({ error: "Mağazaya giriş icazəsi yoxdur" }, { status: 403 });
  try {
    const archived = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT "id" FROM "Store" WHERE "id" = ${access.storeId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${productId} AND "storeId" = ${access.storeId} FOR UPDATE`;
      const changed = await tx.product.updateMany({
        where: { id: productId, storeId: access.storeId },
        data: { status: "ARCHIVED" },
      });
      return changed.count === 1;
    }, { isolationLevel: "Serializable" });
    if (!archived) return NextResponse.json({ error: "Məhsul tapılmadı" }, { status: 404 });
    return NextResponse.json({ archived: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2034") {
      return NextResponse.json({ error: "Məlumatlar paralel olaraq dəyişdirildi. Yenidən cəhd edin." }, { status: 409 });
    }
    console.error("Vendor product archive failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      code: error && typeof error === "object" && "code" in error ? String(error.code) : undefined,
    });
    return NextResponse.json({ error: "Məhsul arxivlənmədi" }, { status: 500 });
  }
}
