import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { assertUniqueVariantCombinations } from "@/lib/product-variants";
import {
  assertVariantLimit,
  EntitlementError,
  getStoreEntitlements,
} from "@/lib/subscription-entitlements";
import { checkVendorProductActivation, isVendorProductActivation } from "@/lib/vendor-product-publication";
import { optionalStockQuantitySchema, requiredStockQuantitySchema } from "@/lib/stock-quantity";
import { findExistingProductSkuMatches, findExistingVariantSkuKeys } from "@/lib/catalog-import-persistence";
import { hasDuplicateNormalizedSkus, nullableSkuSchema } from "@/lib/sku-normalization";

const variantSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(100),
  sku: nullableSkuSchema,
  options: z.record(z.unknown()),
  isActive: z.boolean().default(true),
  price: z.coerce.number().positive().nullable().optional(),
  discountPrice: z.coerce.number().positive().nullable().optional(),
  images: z.array(z.string().min(1).max(500)).max(12).default([]),
  quantity: requiredStockQuantitySchema,
  lowStockThreshold: requiredStockQuantitySchema,
});

export const vendorProductPatchSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().max(5000).nullable(),
  sku: nullableSkuSchema,
  price: z.coerce.number().positive(),
  discountPrice: z.union([z.coerce.number().positive(), z.null()]),
  categoryId: z.string().nullable(),
  brandId: z.string().nullable(),
  images: z.array(z.string().min(1).max(500)).max(12),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
  variantsEnabled: z.boolean().optional(),
  quantity: optionalStockQuantitySchema,
  lowStockThreshold: optionalStockQuantitySchema,
  variants: z.array(variantSchema).max(100).optional(),
});

export type VendorProductPatchValues = z.infer<typeof vendorProductPatchSchema>;
export type VendorProductPatchDatabase = Pick<PrismaClient, "$transaction">;

export type VendorProductStoreAccess = {
  storeId: string;
  user: { id: string; role: string };
} | null;

export function hasVendorProductStoreAccess(access: VendorProductStoreAccess): access is Exclude<VendorProductStoreAccess, null> {
  return access?.user.role === "VENDOR";
}

export class VendorProductPatchError extends Error {
  constructor(readonly code: string, readonly details?: unknown) {
    super(code);
    this.name = "VendorProductPatchError";
  }
}

export async function updateVendorProduct(
  tx: Prisma.TransactionClient,
  input: {
    storeId: string;
    productId: string;
    values: VendorProductPatchValues;
    isOwnedImage: (storeId: string, url: string) => boolean;
    actorUserId: string;
    now?: Date;
  },
) {
  const { storeId, productId, values } = input;

  if (hasDuplicateNormalizedSkus((values.variants || []).map((variant) => variant.sku))) {
    throw new VendorProductPatchError("SKU_CONFLICT");
  }

  await tx.$queryRaw`SELECT "id" FROM "Store" WHERE "id" = ${storeId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "VendorProfile" WHERE "id" = (SELECT "vendorId" FROM "Store" WHERE "id" = ${storeId}) FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = (SELECT "userId" FROM "VendorProfile" WHERE "id" = (SELECT "vendorId" FROM "Store" WHERE "id" = ${storeId})) FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "City" WHERE "id" = (SELECT "cityId" FROM "Store" WHERE "id" = ${storeId}) FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "StoreSubscription" WHERE "storeId" = ${storeId} FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "SubscriptionPlan" WHERE "id" = (SELECT "planId" FROM "StoreSubscription" WHERE "storeId" = ${storeId}) FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${productId} AND "storeId" = ${storeId} FOR UPDATE`;
  if (values.status === "ACTIVE" && values.categoryId) {
    await tx.$queryRaw`SELECT "id" FROM "Category" WHERE "id" = ${values.categoryId} FOR SHARE`;
  }
  await tx.$queryRaw`SELECT "id" FROM "Inventory" WHERE "productId" = ${productId} ORDER BY "id" FOR UPDATE`;

  const product = await tx.product.findFirst({
    where: { id: productId, storeId },
    include: {
      category: { select: { isActive: true } },
      variants: { include: { inventory: true } },
      inventory: true,
    },
  });
  if (!product) throw new VendorProductPatchError("NOT_FOUND");
  if (values.sku && (await findExistingProductSkuMatches(tx, storeId, [values.sku], product.id)).length) {
    throw new VendorProductPatchError("SKU_CONFLICT");
  }
  if (values.images.some((url) => !input.isOwnedImage(storeId, url) && !product.images.includes(url))) {
    throw new VendorProductPatchError("IMAGE_NOT_OWNED");
  }
  if ((values.variants || []).some((variant) => variant.discountPrice != null && variant.discountPrice >= (variant.price ?? values.price))) {
    throw new VendorProductPatchError("INVALID_VARIANT_DISCOUNT");
  }
  if (values.discountPrice !== null && values.discountPrice >= values.price) {
    throw new VendorProductPatchError("INVALID_DISCOUNT");
  }
  try {
    assertUniqueVariantCombinations(values.variants || []);
  } catch (error) {
    throw new VendorProductPatchError(error instanceof Error && error.message === "INVALID_VARIANT_OPTIONS" ? "INVALID_VARIANT_OPTIONS" : "DUPLICATE_VARIANTS");
  }

  const entitlement = await getStoreEntitlements(storeId, tx, input.now);
  const activating = isVendorProductActivation(product.status, values.status);
  const existingVariants = product.variants;
  const variantSkuValues = (values.variants || []).flatMap((variant) => variant.sku ? [variant.sku] : []);
  if (variantSkuValues.length) {
    const existingVariantSkuKeys = await findExistingVariantSkuKeys(
      tx,
      variantSkuValues,
      existingVariants.map((variant) => variant.id),
    );
    if (variantSkuValues.some((sku) => existingVariantSkuKeys.has(sku))) {
      throw new VendorProductPatchError("SKU_CONFLICT");
    }
  }
  const candidateVariants = values.variants === undefined
    ? existingVariants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      options: variant.options,
      isActive: variant.isActive,
      price: variant.price,
      discountPrice: variant.discountPrice,
      inventory: variant.inventory.map((row) => ({
        variantId: row.variantId,
        quantity: row.quantity,
        reserved: row.reserved,
      })),
    }))
    : values.variants.map((variant, index) => {
      const current = variant.id ? existingVariants.find((row) => row.id === variant.id) : null;
      const variantId = variant.id ?? `new-${index}`;
      return {
        id: variantId,
        name: variant.name,
        options: variant.options,
        isActive: variant.isActive,
        price: variant.price ?? null,
        discountPrice: variant.discountPrice ?? null,
        inventory: [{
          variantId,
          quantity: variant.quantity,
          reserved: current?.inventory[0]?.reserved ?? 0,
        }],
      };
    });
  const standardInventory = product.inventory.filter((row) => row.variantId === null);
  const candidateInventory = values.variantsEnabled === false
    ? [{
      variantId: null,
      quantity: values.quantity ?? standardInventory[0]?.quantity ?? 0,
      reserved: standardInventory[0]?.reserved ?? 0,
    }]
    : standardInventory.map((row) => ({ variantId: null, quantity: row.quantity, reserved: row.reserved }));

  if (activating) {
    const category = values.categoryId === product.categoryId
      ? product.category
      : values.categoryId
        ? await tx.category.findFirst({ where: { id: values.categoryId, isActive: true }, select: { isActive: true } })
        : null;
    const store = await tx.store.findUnique({
      where: { id: storeId },
      select: {
        status: true,
        isActive: true,
        legalInfoApproved: true,
        adminManaged: true,
        city: { select: { isActive: true } },
        vendor: {
          select: {
            sellerType: true,
            legalName: true,
            voen: true,
            legalAddress: true,
            user: { select: { isActive: true } },
          },
        },
        subscription: {
          select: {
            status: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
            plan: { select: { slug: true, isActive: true } },
          },
        },
      },
    });
    if (!store) throw new VendorProductPatchError("STORE_NOT_ELIGIBLE", ["Mağaza tapılmadı."]);
    const activeProductCount = await tx.product.count({ where: { storeId, status: "ACTIVE" } });
    const check = checkVendorProductActivation({
      store: {
        status: store.status,
        isActive: store.isActive,
        legalInfoApproved: store.legalInfoApproved,
        adminManaged: store.adminManaged,
        vendorActive: store.vendor.user.isActive,
        cityActive: store.city.isActive,
        sellerType: store.vendor.sellerType,
        legalName: store.vendor.legalName,
        voen: store.vendor.voen,
        legalAddress: store.vendor.legalAddress,
        subscriptionStatus: store.subscription?.status ?? null,
        planSlug: store.subscription?.plan.slug ?? null,
        planActive: store.subscription?.plan.isActive ?? false,
        periodStart: store.subscription?.currentPeriodStart ?? null,
        periodEnd: store.subscription?.currentPeriodEnd ?? null,
      },
      product: {
        id: product.id,
        name: values.name,
        description: values.description,
        price: values.price,
        discountPrice: values.discountPrice,
        categoryId: values.categoryId,
        category,
        inventory: candidateInventory,
        variants: candidateVariants,
      },
      activeProductCount,
      now: input.now,
    });
    if (!check.ok) throw new VendorProductPatchError(check.reason, check);
  }

  const productValues = {
    name: values.name,
    description: values.description,
    sku: values.sku,
    category: values.categoryId ? { connect: { id: values.categoryId } } : { disconnect: true },
    brand: values.brandId ? { connect: { id: values.brandId } } : { disconnect: true },
    status: values.status,
    images: values.images,
    price: new Prisma.Decimal(values.price),
    discountPrice: values.discountPrice === null ? null : new Prisma.Decimal(values.discountPrice),
  };
  const existingActiveVariants = existingVariants.filter((variant) => variant.isActive).length;
  const incomingActiveVariants = (values.variants || []).filter((variant) => variant.isActive).length;
  if (values.variants !== undefined && incomingActiveVariants > existingActiveVariants) {
    if (!entitlement.eligible || !entitlement.plan) throw new EntitlementError("SUBSCRIPTION_REQUIRED", null);
    await assertVariantLimit(tx, storeId, entitlement.plan, product.id, incomingActiveVariants);
  }

  const existingById = new Map(existingVariants.map((variant) => [variant.id, variant] as const));
  const suppliedIds = (values.variants || []).flatMap((variant) => variant.id ? [variant.id] : []);
  if (new Set(suppliedIds).size !== suppliedIds.length || suppliedIds.some((id) => !existingById.has(id))) {
    throw new VendorProductPatchError("VARIANT_NOT_OWNED");
  }
  const existingImageMap = new Map<string, string[]>(existingVariants.map((variant) => [variant.id, variant.images || []]));
  if ((values.variants || []).some((variant) => variant.images.some((url) =>
    !input.isOwnedImage(storeId, url) && !(existingImageMap.get(variant.id ?? "") || []).includes(url)))) {
    throw new VendorProductPatchError("VARIANT_IMAGE_NOT_OWNED");
  }

  if (values.variants !== undefined) {
    await tx.productVariant.updateMany({
      where: { productId: product.id, ...(suppliedIds.length ? { id: { notIn: suppliedIds } } : {}) },
      data: { isActive: false },
    });
  }
  await tx.product.update({ where: { id: product.id }, data: productValues });
  for (const variant of values.variants || []) {
    const variantValues = {
      name: variant.name,
      sku: variant.sku || null,
      options: variant.options as Prisma.InputJsonValue,
      isActive: variant.isActive,
      price: variant.price == null ? null : new Prisma.Decimal(variant.price),
      discountPrice: variant.discountPrice == null ? null : new Prisma.Decimal(variant.discountPrice),
      images: variant.images,
    };
    const current = variant.id
      ? await tx.productVariant.update({ where: { id: variant.id }, data: variantValues, include: { inventory: true } })
      : await tx.productVariant.create({ data: { productId: product.id, ...variantValues }, include: { inventory: true } });
    const inventory = current.inventory[0];
    if (inventory && variant.quantity < inventory.reserved) throw new VendorProductPatchError("STOCK_BELOW_RESERVED");
    if (inventory) {
      const saved = await tx.inventory.update({ where: { id: inventory.id }, data: { quantity: variant.quantity, lowStockThreshold: variant.lowStockThreshold } });
      if (saved.quantity !== inventory.quantity) await tx.inventoryAdjustment.create({ data: { inventoryId: inventory.id, actorUserId: input.actorUserId, delta: saved.quantity - inventory.quantity, previousQuantity: inventory.quantity, newQuantity: saved.quantity, reason: "Məhsul redaktəsində stok yeniləndi" } });
    } else {
      const saved = await tx.inventory.create({ data: { productId: product.id, variantId: current.id, quantity: variant.quantity, lowStockThreshold: variant.lowStockThreshold } });
      if (saved.quantity > 0) await tx.inventoryAdjustment.create({ data: { inventoryId: saved.id, actorUserId: input.actorUserId, delta: saved.quantity, previousQuantity: 0, newQuantity: saved.quantity, reason: "İlkin stok təyin edildi" } });
    }
  }

  if (values.variantsEnabled === false) {
    const existingStock = await tx.inventory.findFirst({ where: { productId: product.id, variantId: null } });
    const quantity = values.quantity ?? existingStock?.quantity ?? 0;
    const threshold = values.lowStockThreshold ?? existingStock?.lowStockThreshold ?? 5;
    if (existingStock && quantity < existingStock.reserved) throw new VendorProductPatchError("STOCK_BELOW_RESERVED");
    if (existingStock) {
      const saved = await tx.inventory.update({ where: { id: existingStock.id }, data: { quantity, lowStockThreshold: threshold } });
      if (saved.quantity !== existingStock.quantity) await tx.inventoryAdjustment.create({ data: { inventoryId: existingStock.id, actorUserId: input.actorUserId, delta: saved.quantity - existingStock.quantity, previousQuantity: existingStock.quantity, newQuantity: saved.quantity, reason: "Standart məhsul stoku təyin edildi" } });
    } else {
      const saved = await tx.inventory.create({ data: { productId: product.id, quantity, lowStockThreshold: threshold } });
      if (saved.quantity > 0) await tx.inventoryAdjustment.create({ data: { inventoryId: saved.id, actorUserId: input.actorUserId, delta: saved.quantity, previousQuantity: 0, newQuantity: saved.quantity, reason: "İlkin stok təyin edildi" } });
    }
  }

  const updated = await tx.product.findUnique({
    where: { id: product.id },
    include: { category: true, brand: true, variants: { include: { inventory: true } }, inventory: true },
  });
  if (!updated) throw new VendorProductPatchError("NOT_FOUND");
  return updated;
}

export function runVendorProductPatch(
  database: VendorProductPatchDatabase,
  input: Parameters<typeof updateVendorProduct>[1],
) {
  return database.$transaction(
    (tx) => updateVendorProduct(tx, input),
    { isolationLevel: "Serializable" },
  );
}
