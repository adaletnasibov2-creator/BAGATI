import type { Prisma } from "@prisma/client";
import { assertUniqueVariantCombinations } from "@/lib/product-variants";
import { missingSellerLegalFields, sellerRequirementLabels } from "@/lib/seller-legal-policy";
import {
  planEntitlements,
  resolveStoreEntitlements,
  type ComplimentaryEntitlementState,
  type EntitlementPlan,
} from "@/lib/subscription-entitlements";

type StockRow = { variantId: string | null; quantity: number; reserved: number };
type ProductVariant = {
  id: string;
  name: string;
  options: unknown;
  isActive: boolean;
  price: number | string | { toString(): string } | null;
  discountPrice: number | string | { toString(): string } | null;
  inventory: StockRow[];
};

export type DraftProductCandidate = {
  id: string;
  name: string;
  description: string | null;
  price: number | string | { toString(): string };
  discountPrice: number | string | { toString(): string } | null;
  categoryId: string | null;
  category: { isActive: boolean } | null;
  inventory: StockRow[];
  variants: ProductVariant[];
};

export type StorePublicationState = {
  status: string;
  isActive: boolean;
  legalInfoApproved: boolean;
  adminManaged: boolean;
  vendorActive: boolean;
  cityActive: boolean;
  sellerType: string | null;
  legalName: string | null;
  voen: string | null;
  legalAddress: string | null;
  subscriptionStatus: string | null;
  planSlug: string | null;
  planActive: boolean;
  periodStart: Date | null;
  periodEnd: Date | null;
  /** Unrevoked admin complimentary (free) grant, or null. Required so callers cannot forget it. */
  complimentary: ComplimentaryEntitlementState;
};

export type ProductPublicationResult = {
  totalDrafts: number;
  published: Array<{ id: string; name: string }>;
  skipped: Array<{ id: string; name: string; reasons: string[] }>;
};

const MAX_PRICE = 9_999_999_999.99;

function validPrice(value: unknown): number | null {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 && price <= MAX_PRICE ? price : null;
}

export function getStorePublicationBlockers(store: StorePublicationState, now = new Date()): string[] {
  const blockers: string[] = [];
  if (store.status !== "ACTIVE") blockers.push("Mağaza admin təsdiqindən keçməyib.");
  if (!store.isActive) blockers.push("Mağazanın ictimai görünürlüğü aktiv deyil.");
  if (!store.vendorActive) blockers.push("Satıcı hesabı deaktivdir.");
  if (!store.cityActive) blockers.push("Mağazanın şəhəri deaktivdir.");

  const missing = missingSellerLegalFields({
    sellerType: store.sellerType,
    legalName: store.legalName,
    voen: store.voen,
    legalAddress: store.legalAddress,
  });
  if (missing.length) blockers.push(`Hüquqi məlumatlar tamamlanmayıb: ${missing.map((field) => sellerRequirementLabels[field]).join(", ")}.`);
  if (!store.legalInfoApproved) blockers.push("Hüquqi məlumatlar admin tərəfindən təsdiqlənməyib.");

  const entitlement = resolveStoreEntitlements({
    adminManaged: store.adminManaged,
    storeStatus: store.status,
    storeActive: store.isActive,
    vendorActive: store.vendorActive,
    cityActive: store.cityActive,
    subscriptionStatus: store.subscriptionStatus,
    planSlug: store.planSlug,
    planActive: store.planActive,
    periodStart: store.periodStart,
    periodEnd: store.periodEnd,
    complimentary: store.complimentary,
  }, now);
  if (!store.adminManaged && !entitlement.eligible) {
    blockers.push("Satış üçün aktiv, qüvvədə olan Basic və ya Pro abunəliyi tələb olunur.");
  }
  return [...new Set(blockers)];
}

export function getProductPublicationBlockers(product: DraftProductCandidate): string[] {
  const blockers: string[] = [];
  const name = product.name.trim();
  if (name.length < 2 || name.length > 160) blockers.push("Məhsul adı 2–160 simvol aralığında olmalıdır.");
  if (product.description && product.description.length > 5000) blockers.push("Məhsul təsviri 5 000 simvoldan uzun ola bilməz.");

  const price = validPrice(product.price);
  if (price === null) blockers.push("Məhsulun qiyməti etibarlı, müsbət məbləğ olmalıdır.");
  const discount = product.discountPrice === null ? null : validPrice(product.discountPrice);
  if (product.discountPrice !== null && (discount === null || price === null || discount >= price)) {
    blockers.push("Endirimli qiymət etibarlı olmalı və əsas qiymətdən aşağı qalmalıdır.");
  }
  if (!product.categoryId) blockers.push("Məhsul üçün kateqoriya seçilməyib.");
  else if (!product.category?.isActive) blockers.push("Məhsulun kateqoriyası mövcud və aktiv deyil.");

  const activeVariants = product.variants.filter((variant) => variant.isActive);
  if (activeVariants.length) {
    for (const variant of activeVariants) {
      const options = variant.options;
      if (variant.name.trim().length < 1 || variant.name.length > 100
        || !options || typeof options !== "object" || Array.isArray(options)
        || !Object.keys(options).length) {
        blockers.push(`${variant.name || "Adsız variant"} üçün ad və xüsusiyyətlər tamamlanmayıb.`);
        continue;
      }
      const variantPrice = variant.price === null ? price : validPrice(variant.price);
      if (variantPrice === null) {
        blockers.push(`${variant.name} variantının qiyməti etibarlı, müsbət məbləğ olmalıdır.`);
      }
      const variantDiscount = variant.discountPrice === null ? discount : validPrice(variant.discountPrice);
      if (variant.discountPrice !== null && variantDiscount === null) {
        blockers.push(`${variant.name} variantının endirimli qiyməti etibarlı deyil.`);
      } else if (variantDiscount !== null && (variantPrice === null || variantDiscount >= variantPrice)) {
        blockers.push(`${variant.name} variantının endirimli qiyməti əsas qiymətdən aşağı olmalıdır.`);
      }
      if (!variant.inventory.some((row) => row.variantId === variant.id)) {
        blockers.push(`${variant.name} variantı üçün stok qeydi yoxdur.`);
      }
    }
    try {
      assertUniqueVariantCombinations(activeVariants.map((variant) => ({
        name: variant.name,
        options: variant.options as Record<string, unknown>,
      })));
    } catch {
      blockers.push("Aktiv variant kombinasiyaları təkrarlanır və ya düzgün formatda deyil.");
    }
  }

  const stockRows = activeVariants.length
    ? activeVariants.flatMap((variant) => variant.inventory.filter((row) => row.variantId === variant.id))
    : product.inventory.filter((row) => row.variantId === null);
  if (!stockRows.length) blockers.push("Satış üçün stok qeydi mövcud deyil.");
  for (const stock of stockRows) {
    if (!Number.isInteger(stock.quantity) || stock.quantity < 0) {
      blockers.push("Stok miqdarı mənfi olmayan tam ədəd olmalıdır.");
    }
    if (!Number.isInteger(stock.reserved) || stock.reserved < 0 || stock.reserved > stock.quantity) {
      blockers.push("Rezerv edilmiş stok ümumi stokdan çox ola bilməz.");
    }
  }
  return [...new Set(blockers)];
}

export async function publishEligibleDraftProducts(
  tx: Prisma.TransactionClient,
  input: {
    storeId: string;
    actorId: string;
    plan: EntitlementPlan | null;
    storeBlockers: string[];
    reason?: string;
  },
): Promise<ProductPublicationResult> {
  await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "storeId" = ${input.storeId} AND "status" = 'DRAFT' ORDER BY "id" FOR UPDATE`;
  const drafts = await tx.product.findMany({
    where: { storeId: input.storeId, status: "DRAFT" },
    include: {
      category: { select: { isActive: true } },
      inventory: { select: { variantId: true, quantity: true, reserved: true } },
      variants: {
        select: {
          id: true, name: true, options: true, isActive: true, price: true, discountPrice: true,
          inventory: { select: { variantId: true, quantity: true, reserved: true } },
        },
      },
    },
    orderBy: { id: "asc" },
  });
  const result: ProductPublicationResult = { totalDrafts: drafts.length, published: [], skipped: [] };
  let activeCount = await tx.product.count({ where: { storeId: input.storeId, status: "ACTIVE" } });
  const productLimit = input.plan ? planEntitlements[input.plan].activeProducts : 0;

  for (const product of drafts) {
    const reasons = [...input.storeBlockers, ...getProductPublicationBlockers(product)];
    if (!reasons.length && (!input.plan || activeCount >= productLimit)) {
      reasons.push(input.plan
        ? `${input.plan} paketinin ${productLimit} aktiv məhsul limiti dolub.`
        : "Məhsulu yayımlamaq üçün satışa uyğun Basic və ya Pro paketi tələb olunur.");
    }
    if (reasons.length) {
      result.skipped.push({ id: product.id, name: product.name, reasons: [...new Set(reasons)] });
      continue;
    }

    const changed = await tx.product.updateMany({
      where: { id: product.id, storeId: input.storeId, status: "DRAFT" },
      data: { status: "ACTIVE" },
    });
    if (changed.count !== 1) {
      result.skipped.push({
        id: product.id,
        name: product.name,
        reasons: ["Məhsul bu əməliyyat zamanı dəyişdirildi; yenidən yoxlayın."],
      });
      continue;
    }

    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: "ADMIN_STORE_AUTO_PUBLISH_PRODUCT",
        entityType: "Product",
        entityId: product.id,
        metadata: {
          storeId: input.storeId,
          previousStatus: "DRAFT",
          nextStatus: "ACTIVE",
          source: "STORE_ACTIVATION",
          reason: input.reason ?? null,
        },
      },
    });
    result.published.push({ id: product.id, name: product.name });
    activeCount++;
  }
  return result;
}
