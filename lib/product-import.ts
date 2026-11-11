import { assertUniqueVariantCombinations } from "@/lib/product-variants";
import { isWellFormedSku, normalizeSku } from "@/lib/sku-normalization";

export type ImportMode = "create" | "update" | "mixed";
export type ImportAction = "create" | "update";

export type ImportVariant = {
  name: string;
  options: Record<string, unknown>;
  sku?: string | null;
  quantity?: number;
  lowStockThreshold?: number;
  price?: number | null;
  discountPrice?: number | null;
  images?: string[];
};

export type ImportProduct = {
  name: string;
  sku: string | null;
  description: string | null;
  price: number;
  discountPrice: number | null;
  categoryId: string | null;
  brandId: string | null;
  quantity: number | null;
  lowStockThreshold: number;
  variants: ImportVariant[];
  images: string[];
};

export type ImportRowCheck = {
  index: number;
  status: "VALID" | "WARNING" | "INVALID" | "SKIPPED";
  errors: string[];
  warnings: string[];
  action: ImportAction;
  product: ImportProduct;
  existingId?: string;
};

export type ImportCategory = { id: string; name: string; slug: string };
export type ImportBrand = { id: string; name: string };
export type ImportExistingProduct = { id: string; sku: string | null; inventory?: { quantity: number; reserved: number } | null };

export class ImportInventoryReservationError extends Error {
  constructor() {
    super("IMPORT_STOCK_BELOW_RESERVED");
    this.name = "ImportInventoryReservationError";
  }
}

const AZ_LOWER = (value: string) => value.trim().normalize("NFKC").toLocaleLowerCase("az-AZ");
const MAX_IMPORT_PRICE = 9_999_999_999;

export function isSafeImportImageUrl(value: string): boolean {
  if (/^\/uploads\/vendors\/[a-zA-Z0-9_-]{1,80}\/[a-f0-9-]+\.(?:jpg|png|webp)$/i.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function parseNumber(raw: string): number {
  return Number(raw.replace(/\s/g, "").replace(",", "."));
}

/** Parse a variants cell (JSON string) into normalized variant drafts. */
export function parseImportVariants(raw: string): { variants: ImportVariant[]; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { variants: [], error: null };
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return { variants: [], error: "Variant məlumatlarının formatı yanlışdır" };
  }
  if (!Array.isArray(data)) return { variants: [], error: "Variant məlumatları JSON massivi olmalıdır" };
  const variants: ImportVariant[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { variants: [], error: "Hər variant obyekt olmalıdır" };
    }
    const record = entry as Record<string, unknown>;
    if (!isWellFormedSku(record.sku)) return { variants: [], error: "Variant məhsul kodu yanlışdır" };
    const options = record.options && typeof record.options === "object" && !Array.isArray(record.options)
      ? (record.options as Record<string, unknown>)
      : {};
    variants.push({
      name: String(record.name ?? "").trim(),
      options,
      sku: normalizeSku(record.sku),
      quantity: record.quantity == null || record.quantity === "" ? 0 : Number(record.quantity),
      lowStockThreshold: record.lowStockThreshold == null || record.lowStockThreshold === "" ? 5 : Number(record.lowStockThreshold),
      price: record.price == null || record.price === "" ? null : Number(record.price),
      discountPrice: record.discountPrice == null || record.discountPrice === "" ? null : Number(record.discountPrice),
      images: Array.isArray(record.images) ? record.images.map((url) => String(url)).filter(Boolean).slice(0, 12) : [],
    });
  }
  return { variants, error: null };
}

/**
 * Validate + plan every import row against the store's existing products.
 *
 * - SKU matches within the same store only (never merges by name alone).
 * - mode "create": existing SKU is rejected; new SKU (or no SKU) is created.
 * - mode "update": a SKU is required and must already exist to update.
 * - mode "mixed": existing SKU updates, new SKU creates (no SKU creates).
 * - Products never auto-publish: created rows are DRAFT; updated rows keep their status.
 */
export function checkImportRows(input: {
  rows: Record<string, unknown>[];
  mapping: Record<string, string>;
  mode: ImportMode;
  categories: ImportCategory[];
  brands: ImportBrand[];
  existing: ImportExistingProduct[];
  existingVariantSkuKeys?: ReadonlySet<string>;
  isImageUrlAllowed?: (url: string) => boolean;
}): ImportRowCheck[] {
  const { rows, mapping, mode, categories, brands, existing } = input;
  const isImageUrlAllowed = input.isImageUrlAllowed ?? isSafeImportImageUrl;
  const categoryMap = new Map<string, ImportCategory>();
  for (const item of categories) {
    categoryMap.set(AZ_LOWER(item.name), item);
    categoryMap.set(AZ_LOWER(item.slug), item);
  }
  const brandMap = new Map<string, ImportBrand>(brands.map((item) => [AZ_LOWER(item.name), item]));
  const existingBySku = new Map<string, ImportExistingProduct>();
  for (const product of existing) {
    const key = normalizeSku(product.sku);
    if (key) existingBySku.set(key, product);
  }
  const seenSkus = new Set<string>();
  const seenVariantSkus = new Set(input.existingVariantSkuKeys);

  return rows.map((row, index) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const get = (key: string) => {
      const column = mapping[key];
      return column ? String(row[column] ?? "").trim() : "";
    };

    const name = get("name");
    const price = parseNumber(get("price"));
    const discountRaw = get("discountPrice");
    const discountPrice = discountRaw ? parseNumber(discountRaw) : null;
    const quantityRaw = mapping.quantity ? get("quantity") : "";
    const parsedQuantity = quantityRaw ? parseNumber(quantityRaw) : null;
    const thresholdRaw = get("lowStockThreshold");
    const lowStockThreshold = thresholdRaw ? parseNumber(thresholdRaw) : 5;
    const rawSku = mapping.sku ? String(row[mapping.sku] ?? "") : "";
    const sku = normalizeSku(rawSku) ?? "";
    const categoryName = get("category");
    const brandName = get("brand");
    const description = get("description") || null;
    const images = get("images")
      ? get("images").split(/[\n,;|]/).map((url) => url.trim()).filter(Boolean).slice(0, 12)
      : [];

    const { variants, error: variantsError } = parseImportVariants(get("variants"));
    if (variantsError) errors.push(variantsError);

    const category = categoryName ? categoryMap.get(AZ_LOWER(categoryName)) ?? null : null;
    const brand = brandName ? brandMap.get(AZ_LOWER(brandName)) ?? null : null;

    if (!name) errors.push("Məhsul adı yoxdur");
    if (name.length > 160) errors.push("Məhsul adı 160 simvoldan çox ola bilməz");
    if (description && description.length > 5000) errors.push("Məhsul təsviri 5000 simvoldan çox ola bilməz");
    if (!isWellFormedSku(rawSku)) errors.push("Məhsul kodu yanlışdır");
    if (rawSku.length > 80 || sku.length > 80) errors.push("Məhsul kodu 80 simvoldan çox ola bilməz");
    if (!Number.isFinite(price) || price <= 0 || price > MAX_IMPORT_PRICE) errors.push("Qiymət müsbət və icazə verilən həddə olmalıdır");
    if (discountPrice !== null && (!Number.isFinite(discountPrice) || discountPrice <= 0 || discountPrice >= price || discountPrice > MAX_IMPORT_PRICE)) {
      errors.push("Endirimli qiymət əsas qiymətdən aşağı olmalıdır");
    }
    if (!categoryName) errors.push("Kateqoriya göstərilməyib");
    else if (!category) errors.push(`Kateqoriya tapılmadı: ${categoryName}`);
    if (brandName && !brand) errors.push(`Brend tapılmadı: ${brandName}`);
    if (parsedQuantity !== null && (!Number.isInteger(parsedQuantity) || parsedQuantity < 0 || parsedQuantity > 1_000_000)) errors.push("Stok sıfır və ya müsbət tam ədəd olmalıdır");
    if (!Number.isInteger(lowStockThreshold) || lowStockThreshold < 0) {
      errors.push("Az stok həddi mənfi olmayan tam ədəd olmalıdır");
    }

    if (variants.length > 50) errors.push("Bir məhsul üçün maksimum 50 variant qəbul edilir");
    if (variants.length) {
      for (const [variantIndex, variant] of variants.entries()) {
        if (!variant.name) errors.push(`Variant ${variantIndex + 1}: ad yoxdur`);
        if (variant.name.length > 100) errors.push(`Variant ${variantIndex + 1}: ad 100 simvoldan çox ola bilməz`);
        if ((variant.sku?.length ?? 0) > 80) errors.push(`Variant ${variantIndex + 1}: məhsul kodu 80 simvoldan çox ola bilməz`);
        const variantSkuKey = normalizeSku(variant.sku);
        if (variantSkuKey) {
          if (seenVariantSkus.has(variantSkuKey)) errors.push(`Variant ${variantIndex + 1}: məhsul kodu artıq mövcuddur və ya faylda təkrarlanır`);
          else seenVariantSkus.add(variantSkuKey);
        }
        if (!Object.keys(variant.options).length) errors.push(`Variant ${variantIndex + 1}: parametrlər yoxdur`);
        const vq = variant.quantity ?? 0;
        if (!Number.isInteger(vq) || vq < 0) errors.push(`Variant ${variantIndex + 1}: stok mənfi olmayan tam ədəd olmalıdır`);
        if (variant.price != null && (!Number.isFinite(variant.price) || (variant.price as number) <= 0 || (variant.price as number) > MAX_IMPORT_PRICE)) {
          errors.push(`Variant ${variantIndex + 1}: qiymət müsbət rəqəm olmalıdır`);
        }
        if (variant.discountPrice != null && (
          !Number.isFinite(variant.discountPrice)
          || variant.discountPrice <= 0
          || variant.discountPrice >= (variant.price ?? price)
          || variant.discountPrice > MAX_IMPORT_PRICE
        )) errors.push(`Variant ${variantIndex + 1}: endirimli qiymət əsas qiymətdən aşağı olmalıdır`);
        if ((variant.images?.length ?? 0) > 12 || (variant.images ?? []).some((url) => url.length > 500)) {
          errors.push(`Variant ${variantIndex + 1}: maksimum 12 və 500 simvoldan qısa şəkil ünvanı qəbul edilir`);
        }
        if ((variant.images ?? []).some((url) => !isImageUrlAllowed(url))) {
          errors.push(`Variant ${variantIndex + 1}: şəkil ünvanı təhlükəsiz deyil və ya mağazaya aid deyil`);
        }
      }
      if (!errors.some((message) => message.startsWith("Variant"))) {
        try {
          assertUniqueVariantCombinations(variants);
        } catch {
          errors.push("Eyni variant kombinasiyası təkrarlanıb");
        }
      }
    }
    if (images.length > 12 || images.some((url) => url.length > 500)) {
      errors.push("Məhsul üçün maksimum 12 və 500 simvoldan qısa şəkil ünvanı qəbul edilir");
    }
    if (images.some((url) => !isImageUrlAllowed(url))) {
      errors.push("Şəkil ünvanı təhlükəsiz deyil və ya mağazaya aid deyil");
    }

    let action: ImportAction = "create";
    let existingId: string | undefined;

    if (sku) {
      const key = normalizeSku(sku)!;
      if (seenSkus.has(key)) {
        errors.push(`Faylda məhsul kodu təkrarlanır: ${sku}`);
      }
      seenSkus.add(key);
      const match = existingBySku.get(key);
      if (mode === "create") {
        if (match) errors.push(`Məhsul kodu artıq mövcuddur: ${sku}`);
      } else if (mode === "update") {
        if (!match) errors.push(`Yeniləmək üçün məhsul kodu tapılmadı: ${sku}`);
        else {
          action = "update";
          existingId = match.id;
          if (match.inventory && parsedQuantity !== null && parsedQuantity < match.inventory.reserved) {
            errors.push("Yeni stok miqdarı rezerv edilmiş stokdan az ola bilməz");
          }
        }
      } else {
        if (match) {
          action = "update";
          existingId = match.id;
          if (match.inventory && parsedQuantity !== null && parsedQuantity < match.inventory.reserved) {
            errors.push("Yeni stok miqdarı rezerv edilmiş stokdan az ola bilməz");
          }
        }
      }
      if (action === "update" && variants.length) {
        errors.push("Mövcud məhsul variantları idxalla yenilənmir; məhsulun redaktə səhifəsindən istifadə edin");
      }
    } else {
      if (mode === "update") {
        errors.push("Yeniləmə rejimi SKU tələb edir (ad görə birləşdirmə edilmir)");
      } else {
        warnings.push("SKU qeyd edilməyib; yeni məhsul yaradılacaq");
      }
    }

    const product: ImportProduct = {
      name,
      sku: sku || null,
      description,
      price,
      discountPrice,
      categoryId: category?.id ?? null,
      brandId: brand?.id ?? null,
      quantity: action === "update" ? parsedQuantity : (parsedQuantity ?? 0),
      lowStockThreshold,
      variants,
      images,
    };

    return {
      index: index + 2,
      status: errors.length ? "INVALID" : warnings.length ? "WARNING" : "VALID",
      errors,
      warnings,
      action,
      product,
      existingId,
    };
  });
}
