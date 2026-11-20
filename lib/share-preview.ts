/**
 * Share preview (Open Graph / Twitter card) for public store and product pages (CART-POLISH + SHARE-PREVIEW).
 * Pure: no database. The pages pass only what they already show publicly, after their own eligibility checks.
 *
 * URLs are absolute from APP_BASE_URL (lib/category-seo.ts absoluteSiteUrl), like the existing canonicals: without
 * a valid base, og:url and og:image are left out rather than pointing at localhost. Images must end up https.
 */
import type { Metadata } from "next";
import { absoluteSiteUrl } from "@/lib/category-seo";

/**
 * Fallback share image: the existing brand mark in public/ (1664×928, close to the 1.91:1 share format). It is the
 * only branded raster image in the repo; a dedicated 1200×630 image is an owner question in the report.
 */
export const DEFAULT_SHARE_IMAGE = { path: "/bagati-logo-reference.png.png", width: 1664, height: 928 } as const;
export const SHARE_LOCALE = "az_AZ";

export type ShareImage = { url: string; width?: number; height?: number; alt?: string };

/** "/uploads/x.webp" -> "https://<base>/uploads/x.webp"; an absolute https URL stays; anything else is null. */
export function absoluteImageUrl(src: string | null | undefined, base: string | undefined = process.env.APP_BASE_URL): string | null {
  const value = src?.trim();
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) {
    const absolute = absoluteSiteUrl(value, base);
    return absolute && absolute.startsWith("https://") ? absolute : null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The page's own image when it can be shared, else the site default (both absolute https), else none. */
export function shareImage(candidates: (string | null | undefined)[], alt: string, base: string | undefined = process.env.APP_BASE_URL): ShareImage | null {
  for (const candidate of candidates) {
    const url = absoluteImageUrl(candidate, base);
    if (url) return { url, alt };
  }
  const fallback = absoluteImageUrl(DEFAULT_SHARE_IMAGE.path, base);
  return fallback ? { url: fallback, width: DEFAULT_SHARE_IMAGE.width, height: DEFAULT_SHARE_IMAGE.height, alt } : null;
}

/** og:* and twitter:* for one public page. `path` is the page's clean URL path (no query, no hash). */
export function sharePreviewMetadata(input: {
  title: string;
  description?: string;
  path: string;
  siteName: string;
  image: ShareImage | null;
  base?: string;
}): Pick<Metadata, "openGraph" | "twitter"> {
  const url = absoluteSiteUrl(input.path, input.base ?? process.env.APP_BASE_URL);
  const images = input.image ? [{ url: input.image.url, ...(input.image.width ? { width: input.image.width } : {}), ...(input.image.height ? { height: input.image.height } : {}), ...(input.image.alt ? { alt: input.image.alt } : {}) }] : undefined;
  return {
    openGraph: {
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      ...(url ? { url } : {}),
      type: "website",
      siteName: input.siteName,
      locale: SHARE_LOCALE,
      ...(images ? { images } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      ...(images ? { images: images.map((image) => image.url) } : {}),
    },
  };
}
