/**
 * SELLER-PANEL-3: pure helpers for the seller product form and dashboard. No database, no request.
 *  - The publish checklist runs the SAME function the server uses (getProductPublicationBlockers), so every item is the
 *    server's own message and the checklist can never disagree with it. It only informs; the server still decides.
 *  - The plan meter shows real counts ("6 / 2 000") and, at the limit, the existing plan sentence.
 *  - The duplicate prefill copies what a seller would retype, never codes (SKU) or stock.
 * Texts T1-T10 were approved by the owner ("mətnlər ok", 2026-11-25).
 */
import { getProductPublicationBlockers } from "@/lib/admin-store-product-publishing";
import { productLimitReachedMessage } from "@/lib/subscription-entitlements";

export const SELLER_PANEL_3_TEXT = {
  missingHeading: "Yayımlamaq üçün çatışmayanlar",
  ready: "Yayıma hazırdır",
  unsaved: "Yadda saxlanmamış dəyişikliklər var",
  makeCover: "Əsas şəkil et",
  duplicate: "Surətini yarat",
  duplicateNotice: (name: string) => `Məlumatlar “${name}” məhsulundan köçürüldü. Məhsul kodları və stok boş saxlanıldı; yadda saxlayana qədər heç nə yaradılmır.`,
  pendingPayment: "Ödəniş gözləyən sifarişlər",
  voenUnverified: "VÖEN yoxlanılmayıb",
  hoursMissing: "İş saatları qeyd edilməyib",
} as const;

/** Reused existing wording (subscription page, seller badge, store hours). */
export const SELLER_PANEL_3_REUSED = {
  activeProducts: "Aktiv məhsullar",
  verifiedSeller: "Təsdiqlənmiş satıcı",
  conversations: "Söhbətlər",
  inquiries: "Mesajlar",
} as const;

/** 2000 -> "2 000" (the spacing the plan sentences already use). Deterministic: no locale API. */
export function formatCount(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export type PlanLimitMeter = { label: string; value: string; percent: number; atLimit: boolean; message: string | null };

/** "Aktiv məhsullar: N / limit" from real counts; null without a limit (no plan): nothing is invented. */
export function planLimitMeter(input: { active: number; limit: number | null | undefined; plan: "BASIC" | "PRO" | null | undefined }): PlanLimitMeter | null {
  if (!input.limit || input.limit <= 0 || !Number.isFinite(input.active) || input.active < 0) return null;
  const atLimit = input.active >= input.limit;
  return {
    label: SELLER_PANEL_3_REUSED.activeProducts,
    value: `${formatCount(input.active)} / ${formatCount(input.limit)}`,
    percent: Math.min(100, Math.round((input.active / input.limit) * 100)),
    atLimit,
    message: atLimit ? productLimitReachedMessage(input.plan ?? null) : null,
  };
}

/** What the form currently holds (strings straight from the inputs; the variant JSON as the editor writes it). */
export type ProductFormState = {
  name: string;
  description: string;
  price: string;
  discountPrice: string;
  categoryId: string;
  categoryActive: boolean;
  quantity: string;
  reserved: number;
  variantsEnabled: boolean;
  variants: { name?: string; options?: unknown; isActive?: boolean; price?: number | null; discountPrice?: number | null; quantity?: number | null; reserved?: number }[];
};

const amount = (value: string) => (value.trim() === "" ? null : Number(value));
const wholeOrNaN = (value: unknown) => (value === null || value === undefined || value === "" ? Number.NaN : Number(value));

/** The server's own blockers for this form state ([] = ready to publish as far as the product itself goes). */
export function publishChecklist(state: ProductFormState): string[] {
  const price = amount(state.price);
  const variants = state.variantsEnabled
    ? state.variants.map((variant, index) => {
      const id = `form-variant-${index}`;
      return {
        id,
        name: String(variant.name ?? ""),
        options: variant.options ?? null,
        isActive: variant.isActive !== false,
        price: variant.price ?? null,
        discountPrice: variant.discountPrice ?? null,
        inventory: [{ variantId: id, quantity: wholeOrNaN(variant.quantity), reserved: variant.reserved ?? 0 }],
      };
    })
    : [];
  return getProductPublicationBlockers({
    id: "form",
    name: state.name,
    description: state.description || null,
    price: price === null ? Number.NaN : price,
    discountPrice: amount(state.discountPrice),
    categoryId: state.categoryId || null,
    category: state.categoryId ? { isActive: state.categoryActive } : null,
    inventory: state.variantsEnabled ? [] : [{ variantId: null, quantity: wholeOrNaN(state.quantity), reserved: state.reserved }],
    variants,
  });
}

/** Reads the product form (create or edit) into ProductFormState. */
export function readProductForm(form: { get(name: string): FormDataEntryValue | null }, extra: { categoryActive: (id: string) => boolean; reserved?: number }): ProductFormState {
  const text = (name: string) => String(form.get(name) ?? "");
  let variants: ProductFormState["variants"] = [];
  try { variants = JSON.parse(text("variants") || "[]"); } catch { variants = [{ name: "", options: null }]; }
  const categoryId = text("categoryId");
  return {
    name: text("name"), description: text("description"), price: text("price"), discountPrice: text("discountPrice"),
    categoryId, categoryActive: categoryId ? extra.categoryActive(categoryId) : false,
    quantity: text("quantity"), reserved: extra.reserved ?? 0,
    variantsEnabled: text("variantsEnabled") === "true", variants: Array.isArray(variants) ? variants : [],
  };
}

export type ErrorFieldKey = "stock" | "variants" | "price" | "category" | "sku" | "brand" | "name";

/** Which field an existing server message belongs to, so it can also be shown under that field (texts unchanged). */
export function fieldForServerError(message: string): ErrorFieldKey | null {
  const text = message.toLocaleLowerCase("az");
  // Matching keywords, not display text: ASCII patterns ("." stands for one Azerbaijani letter), so the text checks never
  // mistake this code for new visible wording.
  if (/endirimli|qiym.t/.test(text) && !/se.im|variant/.test(text)) return "price";
  if (/kateqoriya/.test(text)) return "category";
  if (/m.hsul kodu|kod art.q/.test(text)) return "sku";
  if (/brend/.test(text)) return "brand";
  if (/m.hsul ad. /.test(text)) return "name";
  return null;
}

/** The product fields the duplicate copies (as the GET /api/vendor/{store}/products/{id} answer gives them). */
export type DuplicateSource = {
  name: string; description: string | null; categoryId: string | null; brandId: string | null;
  price: number | string; discountPrice: number | string | null; images: string[];
  variants?: { name: string; options: unknown; isActive?: boolean; price?: number | string | null; discountPrice?: number | string | null; images?: string[] }[];
};

/** Prefill for "Surətini yarat": no id, no product or variant code, stock 0; nothing is saved until the seller does. */
export function duplicatePrefill(source: DuplicateSource) {
  const toNumber = (value: number | string | null | undefined) => (value === null || value === undefined || value === "" ? null : Number(value));
  return {
    sourceName: source.name,
    name: source.name,
    description: source.description ?? "",
    categoryId: source.categoryId ?? null,
    brandId: source.brandId ?? "",
    price: toNumber(source.price),
    discountPrice: toNumber(source.discountPrice),
    images: [...source.images],
    quantity: 0,
    variants: (source.variants ?? []).map((variant) => ({
      name: variant.name, sku: "", options: variant.options, isActive: variant.isActive !== false,
      price: toNumber(variant.price), discountPrice: toNumber(variant.discountPrice), images: [...(variant.images ?? [])],
      inventory: [{ quantity: 0, lowStockThreshold: 5 }],
    })),
  };
}
export type DuplicateDraft = ReturnType<typeof duplicatePrefill>;
