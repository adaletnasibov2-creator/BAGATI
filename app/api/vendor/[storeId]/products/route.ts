import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireStoreAccess } from "@/lib/auth";
import { resolvePublicStoreEligibility } from "@/lib/store-eligibility";
import { prisma } from "@/lib/prisma";
import { isOwnedStoreAssetUrl } from "@/lib/storage/store-assets";
import { assertUniqueVariantCombinations } from "@/lib/product-variants";
import { matchesProductStockFilter } from "@/lib/vendor-inventory";
import { categoriesWithOtherLast } from "@/lib/category-order";
import { assertProductLimit, assertVariantLimit, EntitlementError, entitlementErrorResponse, lockStoreEntitlement } from "@/lib/subscription-entitlements";
import { collectStockFilteredPage, type StockPageCursor } from "@/lib/vendor-product-stock-page";
import { findExistingProductSkuMatches, findExistingVariantSkuKeys, CatalogSkuConflictError, isSkuUniqueViolation } from "@/lib/catalog-import-persistence";
import { hasDuplicateNormalizedSkus } from "@/lib/sku-normalization";
import { vendorProductCreateSchema } from "@/lib/vendor-product-schemas";

const db: any = prisma;
class StoreNotEligibleError extends Error {}
type ProductStockLevel = { quantity: number; reserved: number; lowStockThreshold: number; variantId?: string | null };
type ProductStockCandidate = {
  id: string;
  createdAt: Date;
  inventory: ProductStockLevel[];
  variants: { inventory: ProductStockLevel[] }[];
};
type VendorProductListingItem = {
  id: string;
  images: string[];
  inventory: ProductStockLevel[];
  variants: { isActive: boolean; inventory: ProductStockLevel[] }[];
  [key: string]: unknown;
};
const slugify = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mehsul";

export async function GET(request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const access = await requireStoreAccess(storeId);
  if (!access || access.user.role !== "VENDOR") return NextResponse.json({ error: "Mağazaya giriş icazəsi yoxdur" }, { status: 403 });
  const q = request.nextUrl.searchParams.get("q")?.trim() || "";
  const categoryId = request.nextUrl.searchParams.get("categoryId") || undefined;
  const requestedStatus = request.nextUrl.searchParams.get("status") || undefined;
  const statuses = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
  if (requestedStatus && !statuses.includes(requestedStatus as typeof statuses[number])) {
    return NextResponse.json({ error: "Məhsul statusu düzgün deyil" }, { status: 400 });
  }
  const status = requestedStatus as typeof statuses[number] | undefined;
  const stock = request.nextUrl.searchParams.get("stock") || undefined;
  if (stock && stock !== "low" && stock !== "out") {
    return NextResponse.json({ error: "Stok filtri düzgün deyil" }, { status: 400 });
  }
  const rawPage = request.nextUrl.searchParams.get("page");
  const requestedPage = rawPage === null ? 1 : Number(rawPage);
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
    return NextResponse.json({ error: "Səhifə nömrəsi düzgün deyil" }, { status: 400 });
  }
  const take = 24;
  const where: Prisma.ProductWhereInput = {
    storeId: access.storeId,
    ...(categoryId ? { categoryId } : {}),
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [categories, brands] = await Promise.all([
    db.category.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.brand.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  let total = 0;
  let page = requestedPage;
  let items: VendorProductListingItem[];
  if (stock === "low" || stock === "out") {
    const stockPage = await collectStockFilteredPage<ProductStockCandidate>({
      page: requestedPage,
      pageSize: take,
      // Bound relation materialization while avoiding one inventory query per product.
      batchSize: 250,
      loadBatch: (cursor?: StockPageCursor) => db.product.findMany({
        where: cursor
          ? {
            AND: [
              where,
              {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                ],
              },
            ],
          }
          : where,
        select: {
          id: true,
          createdAt: true,
          inventory: { where: { variantId: null }, select: { quantity: true, reserved: true, lowStockThreshold: true } },
          variants: {
            where: { isActive: true },
            select: { inventory: { select: { quantity: true, reserved: true, lowStockThreshold: true } } },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 250,
      }),
      matches: (product) => matchesProductStockFilter(product, stock),
    });
    total = stockPage.total;
    page = stockPage.page;
    items = stockPage.items.length
      ? await db.product.findMany({
        where: { ...where, id: { in: stockPage.items.map((product) => product.id) } },
        include: {
          category: { select: { id: true, name: true } },
          inventory: true,
          variants: { select: { id: true, name: true, sku: true, options: true, isActive: true, inventory: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      })
      : [];
  } else {
    total = await db.product.count({ where });
    const pages = Math.ceil(total / take);
    page = pages ? Math.min(requestedPage, pages) : 1;
    items = await db.product.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
        inventory: true,
        variants: { select: { id: true, name: true, sku: true, options: true, isActive: true, inventory: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * take,
      take,
    });
  }
  const eligibleStoreIds = await resolvePublicStoreEligibility([access.storeId], db);
  const withStock = items.map((product: any) => { const rows = product.variants.length ? product.variants.filter((variant: any) => variant.isActive).flatMap((variant: any) => variant.inventory) : product.inventory.filter((inventory: any) => inventory.variantId === null); const stockQuantity = rows.reduce((sum: number, row: any) => sum + row.quantity, 0), stockReserved = rows.reduce((sum: number, row: any) => sum + row.reserved, 0); return { ...product, stockQuantity, stockReserved, availableStock: Math.max(0, stockQuantity - stockReserved), lowStockThreshold: Math.max(0, ...rows.map((row: any) => row.lowStockThreshold)), activeVariantCount: product.variants.filter((variant: any) => variant.isActive).length }; });
  return NextResponse.json({ items: withStock, total, page, pages: Math.max(1, Math.ceil(total / take)), categories: categoriesWithOtherLast(categories), brands, canSell: eligibleStoreIds.has(access.storeId) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const access = await requireStoreAccess(storeId);
  if (!access || access.user.role !== "VENDOR") return NextResponse.json({ error: "Mağazaya giriş icazəsi yoxdur" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Məhsul məlumatı yanlışdır" }, { status: 400 }); }
  const parsed = vendorProductCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Məhsul məlumatlarını yoxlayın", details: parsed.error.flatten() }, { status: 422 });
  const value = parsed.data;
  if (hasDuplicateNormalizedSkus(value.variants.map((variant) => variant.sku))) {
    return NextResponse.json({ error: "Variant SKU-ləri təkrarlana bilməz" }, { status: 409 });
  }
  if (value.variantsEnabled && !value.variants.length) return NextResponse.json({ error: "Variant xüsusiyyətləri və kombinasiyaları tələb olunur" }, { status: 422 });
  if (value.variantsEnabled === false && value.variants.length) return NextResponse.json({ error: "Variantlar söndürüldükdə kombinasiyaları göndərmək olmaz" }, { status: 422 });
  try { assertUniqueVariantCombinations(value.variants); }
  catch (error) { return NextResponse.json({ error: error instanceof Error && error.message === "INVALID_VARIANT_OPTIONS" ? "Variant xüsusiyyətlərinin formatı yanlışdır" : "Variant kombinasiyaları təkrarlana bilməz" }, { status: 422 }); }
  if (value.discountPrice != null && value.discountPrice >= value.price) return NextResponse.json({ error: "Endirimli qiymət əsas qiymətdən aşağı olmalıdır" }, { status: 422 });
  if (value.images.some(url => !isOwnedStoreAssetUrl(access.storeId, url))) return NextResponse.json({ error: "Yalnız bu mağazaya yüklənmiş şəkillərdən istifadə edin" }, { status: 422 });
  if (value.variants.some(variant => variant.images.some(url => !isOwnedStoreAssetUrl(access.storeId, url)))) return NextResponse.json({ error: "Variant şəkillərini bu mağazanın yükləmə bölməsindən əlavə edin" }, { status: 422 });
  if (value.variants.some(variant => variant.discountPrice != null && variant.discountPrice >= (variant.price ?? value.price))) return NextResponse.json({ error: "Variant endirimli qiyməti onun əsas qiymətindən aşağı olmalıdır" }, { status: 422 });
  if (value.categoryId && !await db.category.findFirst({ where: { id: value.categoryId, isActive: true }, select: { id: true } })) return NextResponse.json({ error: "Aktiv kateqoriya tapılmadı" }, { status: 422 });
  if (value.brandId && !await db.brand.findUnique({ where: { id: value.brandId }, select: { id: true } })) return NextResponse.json({ error: "Brend tapılmadı" }, { status: 422 });
  if (value.status === "ACTIVE") {
    if (!value.categoryId) return NextResponse.json({ error: "Məhsulu yayımlamaq üçün kateqoriya seçin" }, { status: 422 });
  }
  try {
    const product = await db.$transaction(async (tx: any) => {
      if (value.status === "ACTIVE") {
        const eligibleStoreIds = await resolvePublicStoreEligibility([access.storeId], tx);
        if (!eligibleStoreIds.has(access.storeId)) throw new StoreNotEligibleError();
      }
      if (value.sku && (await findExistingProductSkuMatches(tx, access.storeId, [value.sku])).length) {
        throw new CatalogSkuConflictError("PRODUCT");
      }
      const variantSkus = value.variants.flatMap((variant) => variant.sku ? [variant.sku] : []);
      if (variantSkus.length) {
        const existingVariantSkus = await findExistingVariantSkuKeys(tx, variantSkus);
        if (variantSkus.some((sku) => existingVariantSkus.has(sku))) throw new CatalogSkuConflictError("VARIANT");
      }
      const activeVariants = value.variants.filter(variant => variant.isActive).length;
      if (value.status === "ACTIVE" || activeVariants > 0) {
        const entitlement = await lockStoreEntitlement(tx, access.storeId);
        if (!entitlement.eligible || !entitlement.plan) throw new EntitlementError("SUBSCRIPTION_REQUIRED", null);
        if (value.status === "ACTIVE") await assertProductLimit(tx, access.storeId, entitlement.plan);
        if (activeVariants) await assertVariantLimit(tx, access.storeId, entitlement.plan, "", activeVariants);
      }
      const item = await tx.product.create({ data: { storeId: access.storeId, name: value.name, slug: `${slugify(value.name)}-${crypto.randomUUID().slice(0, 8)}`, description: value.description || null, sku: value.sku || null, price: new Prisma.Decimal(value.price), discountPrice: value.discountPrice == null ? null : new Prisma.Decimal(value.discountPrice), categoryId: value.categoryId || null, brandId: value.brandId || null, images: value.images, status: value.status } });
      if (value.variants.length) {
        for (const variant of value.variants) {
          const created = await tx.productVariant.create({ data: { productId: item.id, name: variant.name, options: variant.options, sku: variant.sku || null, isActive: variant.isActive, price: variant.price == null ? null : new Prisma.Decimal(variant.price), discountPrice: variant.discountPrice == null ? null : new Prisma.Decimal(variant.discountPrice), images: variant.images } });
          const inventory = await tx.inventory.create({ data: { productId: item.id, variantId: created.id, quantity: variant.quantity, lowStockThreshold: variant.lowStockThreshold } });
          if (variant.quantity > 0) await tx.inventoryAdjustment.create({ data: { inventoryId: inventory.id, actorUserId: access.user.id, delta: variant.quantity, previousQuantity: 0, newQuantity: variant.quantity, reason: "İlkin stok təyin edildi" } });
        }
      } else {
        const inventory = await tx.inventory.create({ data: { productId: item.id, quantity: value.quantity, lowStockThreshold: value.lowStockThreshold } });
        if (value.quantity > 0) await tx.inventoryAdjustment.create({ data: { inventoryId: inventory.id, actorUserId: access.user.id, delta: value.quantity, previousQuantity: 0, newQuantity: value.quantity, reason: "İlkin stok təyin edildi" } });
      }
      return item;
    });
    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    if (error instanceof StoreNotEligibleError) return NextResponse.json({ error: "Məhsul yalnız aktiv mağaza, satıcı hesabı və abunəlik olduqda yayımlana bilər" }, { status: 409 });
    if (error instanceof EntitlementError) return entitlementErrorResponse(error);
    if (error instanceof CatalogSkuConflictError) {
      const errorMessage = error.scope === "PRODUCT"
        ? "Bu mağazada həmin məhsul SKU-su artıq mövcuddur"
        : "Bu variant SKU-su artıq başqa variantda istifadə olunur";
      return NextResponse.json({ error: errorMessage }, { status: 409 });
    }
    if (isSkuUniqueViolation(error)) return NextResponse.json({ error: "Bu SKU artıq istifadədədir. Başqa məhsul və ya variant kodu seçin." }, { status: 409 });
    return NextResponse.json({ error: "Məhsul yaradıla bilmədi" }, { status: 500 });
  }
}
