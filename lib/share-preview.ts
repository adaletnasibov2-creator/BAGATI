/**
 * Share preview (Open Graph / Twitter card) for public store and product pages (CART-POLISH + SHARE-PREVIEW).
 * Pure: no database. The pages pass only what they already show publicly, after their own eligibility checks.
 *
 * URLs are absolute from APP_BASE_URL (lib/category-seo.ts absoluteSiteUrl), like the existing canonicals: without
 * a valid base, og:url and og:image are left out rather than pointing at localhost. Images must end up https.
 */
import type { Metadata } from "next";
import { absoluteSiteUrl, categoryPageMetadata } from "@/lib/category-seo";
import { categoryHref } from "@/lib/category-tree";

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

// ---------------------------------------------------------------------------------------------------------------
// SMALL-FIXES-1 C + D

/**
 * rel=canonical for a public store or product page: the same absolute URL as og:url (same `path`, same base rule).
 * Without a valid APP_BASE_URL it is left out, like og:url. Non-public pages never call this (their metadata is {}).
 */
export function canonicalMetadata(path: string, base: string | undefined = process.env.APP_BASE_URL): Pick<Metadata, "alternates"> {
  const url = absoluteSiteUrl(path, base);
  return url ? { alternates: { canonical: url } } : {};
}

/**
 * Home page share preview from the existing site settings only: the admin's Open Graph title/description when set,
 * else the site name and the default SEO description. og:url is the site root; image = the default share image.
 * The page's <title> is not set here (the root layout's default title stays).
 */
export function homeSharePreviewMetadata(input: { siteName: string; description: string | null; ogTitle: string | null; ogDescription: string | null; base?: string }): Pick<Metadata, "openGraph" | "twitter"> {
  const title = input.ogTitle?.trim() || input.siteName;
  const description = input.ogDescription?.trim() || input.description?.trim() || undefined;
  return sharePreviewMetadata({ title, description, path: "/", siteName: input.siteName, image: shareImage([], title, input.base ?? process.env.APP_BASE_URL), base: input.base });
}

/**
 * Category page: categoryPageMetadata (title, description, canonical, noindex) plus the full share preview.
 * Only for a public category: an unknown, inactive or hidden one keeps the bare "not found" metadata, so its name
 * and image never reach the head. Image: the category's own photo when it is an owned/https URL, else the default.
 */
export function categorySharePreviewMetadata(input: Parameters<typeof categoryPageMetadata>[0] & { category: { name: string; slug: string; isActive: boolean; imageUrl?: string | null } | null; siteName: string }): Metadata {
  const metadata = categoryPageMetadata(input);
  if (!input.category) return metadata;
  const title = typeof metadata.title === "string" ? metadata.title : input.category.name;
  const description = typeof metadata.description === "string" ? metadata.description : undefined;
  const base = input.base ?? process.env.APP_BASE_URL;
  return {
    ...metadata,
    ...sharePreviewMetadata({ title, description, path: categoryHref(input.category.slug), siteName: input.siteName, image: shareImage([input.category.imageUrl], title, base), base }),
  };
}
