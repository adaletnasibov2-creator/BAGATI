/**
 * SEO-1: robots.txt rules and schema.org JSON-LD (Product on the product page, WebSite + Organization on the home
 * page). Pure: no database, no request. Pages pass only what they already show, after their own eligibility checks.
 *
 * Only real data: no rating, review, shipping, return or delivery claims, no brand (the product page does not show
 * one). URLs are absolute from APP_BASE_URL (lib/category-seo.ts absoluteSiteUrl, the same rule as the canonicals);
 * without a valid base the URL fields are left out.
 */
import type { MetadataRoute } from "next";
import { absoluteSiteUrl } from "@/lib/category-seo";
import { absoluteImageUrl, DEFAULT_SHARE_IMAGE } from "@/lib/share-preview";

// ---------------------------------------------------------------------------------------------------------------
// robots.txt

/**
 * Private or per-visitor areas. /admin is deliberately NOT listed: naming it would advertise the admin path
 * (lib/admin-surface.ts, scripts/admin-entry-hardening.test.ts); admin pages and APIs already send
 * X-Robots-Tag noindex and /api below covers /api/admin without naming it. /_next and images stay allowed (Google
 * needs them to render the pages).
 */
export const ROBOTS_DISALLOW = [
  "/api", "/vendor", "/account", "/cart", "/checkout", "/orders", "/favorites",
  "/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/auth",
] as const;

export function robotsConfig(base: string | undefined = process.env.APP_BASE_URL): MetadataRoute.Robots {
  const sitemap = absoluteSiteUrl("/sitemap.xml", base);
  return {
    rules: { userAgent: "*", allow: "/", disallow: [...ROBOTS_DISALLOW] },
    ...(sitemap ? { sitemap } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// JSON-LD

export type JsonLd = Record<string, unknown>;

/**
 * JSON for a <script type="application/ld+json"> body. Seller-written text (names, descriptions) must never close
 * the script tag or open a comment/CDATA: "<", ">" and "&" become \u escapes (still the same JSON value), and the
 * two line separators that old JavaScript parsers reject are escaped as well.
 */
export function serializeJsonLd(data: JsonLd | JsonLd[]): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export const JSON_LD_DESCRIPTION_MAX = 5000;
const IN_STOCK = "https://schema.org/InStock";
const OUT_OF_STOCK = "https://schema.org/OutOfStock";

/** Plain text: whitespace collapsed, trimmed, at most 5000 characters; empty -> undefined. */
export function plainJsonLdText(value: string | null | undefined, max = JSON_LD_DESCRIPTION_MAX): string | undefined {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export type ProductJsonLdInput = {
  id: string;
  name: string;
  description: string | null;
  images: string[];
  sku: string | null;
  storeName: string;
  /** Effective price the page shows for the product itself (calculateEffectivePrice(...).unitPrice), "12.50". */
  unitPrice: string;
  /** Product-level stock as the page computes it (no-variant products). */
  stock: number;
  /** All variants as the page builds them; inactive ones are ignored (the page never sells them). */
  variants: { isActive: boolean; available: number; unitPrice: string }[];
  base?: string;
};

/**
 * schema.org Product for one public product page. Offers follow the page:
 * - no variants: one Offer at the product price, InStock when stock > 0;
 * - variants: the active ones; one Offer when they all cost the same, else an AggregateOffer with lowPrice/highPrice;
 *   InStock when at least one active variant has stock. No active variant: one OutOfStock Offer at the product price.
 */
export function productJsonLd(input: ProductJsonLdInput): JsonLd {
  const base = input.base ?? process.env.APP_BASE_URL;
  const url = absoluteSiteUrl(`/products/${input.id}`, base) ?? undefined;
  const images = [...new Set(input.images.map((image) => absoluteImageUrl(image, base)).filter((image): image is string => Boolean(image)))];
  const description = plainJsonLdText(input.description);
  const seller = { "@type": "Organization", name: input.storeName };
  const offerBase = { priceCurrency: "AZN", ...(url ? { url } : {}), seller };

  const hasVariants = input.variants.length > 0;
  const active = input.variants.filter((variant) => variant.isActive);
  let offers: JsonLd;
  if (!hasVariants || active.length === 0) {
    const available = hasVariants ? false : input.stock > 0;
    offers = { "@type": "Offer", price: input.unitPrice, availability: available ? IN_STOCK : OUT_OF_STOCK, ...offerBase };
  } else {
    const prices = active.map((variant) => Number(variant.unitPrice));
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    const availability = active.some((variant) => variant.available > 0) ? IN_STOCK : OUT_OF_STOCK;
    offers = low === high
      ? { "@type": "Offer", price: low.toFixed(2), availability, ...offerBase }
      : { "@type": "AggregateOffer", lowPrice: low.toFixed(2), highPrice: high.toFixed(2), offerCount: active.length, availability, ...offerBase };
  }

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.name,
    ...(images.length ? { image: images } : {}),
    ...(description ? { description } : {}),
    ...(input.sku?.trim() ? { sku: input.sku.trim() } : {}),
    ...(url ? { url } : {}),
    offers,
  };
}

export const SITE_JSON_LD_NAME = "BAGATI";

/** WebSite + Organization for the home page; null without a valid APP_BASE_URL (no url to give). No SearchAction. */
export function homeJsonLd(base: string | undefined = process.env.APP_BASE_URL): JsonLd | null {
  const url = absoluteSiteUrl("/", base);
  if (!url) return null;
  const logo = absoluteImageUrl(DEFAULT_SHARE_IMAGE.path, base);
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": `${url}#website`, name: SITE_JSON_LD_NAME, url, publisher: { "@id": `${url}#organization` } },
      { "@type": "Organization", "@id": `${url}#organization`, name: SITE_JSON_LD_NAME, url, ...(logo ? { logo } : {}) },
    ],
  };
}
