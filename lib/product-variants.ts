import { Prisma } from "@prisma/client";
import { calculateEffectivePrice, productPromotions, type PromotionPriceInput } from "@/lib/promotion-pricing";

export type VariantOptionRecord = Record<string, unknown>;
export type VariantDraft = {
  id?: string;
  name: string;
  options: VariantOptionRecord;
  sku?: string | null;
  isActive?: boolean;
  price?: number | Prisma.Decimal | null;
  discountPrice?: number | Prisma.Decimal | null;
  images?: string[];
  quantity?: number;
  lowStockThreshold?: number;
};

function normalizedOptions(options: VariantOptionRecord) {
  const result = new Map<string, string>();
  for (const [rawKey, rawValue] of Object.entries(options)) {
    const key = rawKey.trim().normalize("NFKC").toLocaleLowerCase("az-AZ");
    const value = String(rawValue ?? "").trim().normalize("NFKC").toLocaleLowerCase("az-AZ");
    if (!key || !value) throw new Error("INVALID_VARIANT_OPTIONS");
    if (result.has(key)) throw new Error("DUPLICATE_VARIANT_ATTRIBUTE");
    result.set(key, value);
  }
  return [...result.entries()].sort(([a], [b]) => a.localeCompare(b, "az-AZ"));
}

export function variantCombinationKey(options: VariantOptionRecord, fallbackName = "") {
  const entries = normalizedOptions(options);
  return entries.length ? JSON.stringify(entries) : `legacy:${fallbackName.trim().normalize("NFKC").toLocaleLowerCase("az-AZ")}`;
}

export function assertUniqueVariantCombinations(variants: Array<Pick<VariantDraft, "name" | "options">>) {
  const keys = new Set<string>();
  for (const variant of variants) {
    const key = variantCombinationKey(variant.options, variant.name);
    if (keys.has(key)) throw new Error("DUPLICATE_VARIANT_COMBINATION");
    keys.add(key);
  }
}

export function isVariantForProduct(variant: { productId: string }, productId: string) {
  return variant.productId === productId;
}

export function isVariantOwnedByStore(variant: { product: { storeId: string } }, storeId: string) {
  return variant.product.storeId === storeId;
}

export type VariantInventory = { id: string; variantId: string | null; quantity: number; reserved: number };
export type PurchasableVariant = { id: string; productId: string; isActive: boolean };

export function resolveVariantInventory(
  productId: string,
  variantId: string | null,
  variants: PurchasableVariant[],
  inventory: VariantInventory[],
  quantity: number,
) {
  let selected: PurchasableVariant | null = null;
  const activeVariants = variants.filter((variant) => variant.isActive);
  if (variantId) {
    selected = variants.find((variant) => variant.id === variantId) ?? null;
    if (!selected || !isVariantForProduct(selected, productId)) throw new Error("VARIANT_INVALID");
    if (!selected.isActive) throw new Error("VARIANT_INACTIVE");
  } else if (activeVariants.length) {
    throw new Error("VARIANT_REQUIRED");
  }
  const stock = inventory.find((row) => row.variantId === (selected?.id ?? null));
  if (!stock) throw new Error("VARIANT_INVENTORY_MISSING");
  const available = Math.max(0, stock.quantity - stock.reserved);
  if (!Number.isInteger(quantity) || quantity < 1 || available < quantity) throw new Error("VARIANT_OUT_OF_STOCK");
  return { variant: selected, inventory: stock, available };
}

export function quantityAfterSale(quantity: number, reserved: number, sold: number) {
  if (![quantity, reserved, sold].every(Number.isInteger) || quantity < 0 || reserved < 0 || sold < 1 || quantity - reserved < sold) {
    throw new Error("VARIANT_OUT_OF_STOCK");
  }
  return quantity - sold;
}

export function cartVariantKey(productId: string, variantId: string | null) {
  return `${productId}\u0000${variantId ?? ""}`;
}

export function calculateVariantEffectivePrice(input: {
  productPrice: Prisma.Decimal.Value;
  productDiscountPrice: Prisma.Decimal.Value | null;
  variant?: { price: Prisma.Decimal.Value | null; discountPrice: Prisma.Decimal.Value | null } | null;
  promotions?: Array<{ promotion: PromotionPriceInput }>;
  storeId: string;
  now?: Date;
}) {
  const price = input.variant?.price ?? input.productPrice;
  const discountPrice = input.variant?.discountPrice ?? input.productDiscountPrice;
  return calculateEffectivePrice(price, discountPrice, productPromotions(input.promotions ?? [], input.storeId), input.now);
}

export function orderVariantSnapshot(variant: { name: string; options: Prisma.JsonValue } | null) {
  return variant ? { variantName: variant.name, variantOptions: JSON.parse(JSON.stringify(variant.options)) as Prisma.InputJsonValue } : { variantName: null, variantOptions: Prisma.DbNull };
}
