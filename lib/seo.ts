/**
 * Pure SEO helpers fed by the settings engine (seo.* keys). No database, no environment: unit-tested.
 * Next.js escapes metadata values when it renders the <meta> tags; these helpers only shape the strings.
 */
import type { Metadata } from "next";

export const META_DESCRIPTION_MAX = 160;
const STORE_PLACEHOLDER = "{store}";

/** Collapses whitespace and cuts at `max` characters (with an ellipsis when cut). */
export function shortenMetaText(value: string, max = META_DESCRIPTION_MAX): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Store page description: the store's own description when it has one, otherwise the template with {store}
 * replaced by the store name. The name is inserted literally (split/join, so "$&" or "$1" in a name are not
 * replacement patterns). Always at most 160 characters.
 */
export function storeMetaDescription(input: { template: string; storeName: string; storeDescription: string | null }): string {
  const own = input.storeDescription?.trim();
  if (own) return own.slice(0, META_DESCRIPTION_MAX);
  return shortenMetaText(input.template.split(STORE_PLACEHOLDER).join(input.storeName));
}

/**
 * Root metadata. Open Graph tags are added only for the fields the admin filled in; with both empty there is no
 * openGraph key at all (the behaviour before the setting existed).
 *
 * LAUNCH-TECH-1: with `shareImage` (the default 1200×630 image, absolute https URL) every page that sets no share
 * image of its own still gets og:image and a large Twitter card; no text is added (no og:title unless the admin set
 * one). Pages with their own openGraph / twitter metadata (home, categories, stores, products) replace these.
 */
export function rootMetadata(input: { siteName: string; logoUrl: string | null; description: string; ogTitle: string | null; ogDescription: string | null; shareImage?: { url: string; width?: number; height?: number; alt?: string } | null }): Metadata {
  const openGraph = {
    ...(input.ogTitle ? { title: input.ogTitle } : {}),
    ...(input.ogDescription ? { description: input.ogDescription } : {}),
  };
  const image = input.shareImage ?? null;
  return {
    title: { default: input.siteName, template: `%s | ${input.siteName}` },
    description: input.description,
    applicationName: input.siteName,
    icons: { icon: input.logoUrl ?? "/icon.svg", shortcut: input.logoUrl ?? "/icon.svg" },
    ...(Object.keys(openGraph).length || image ? { openGraph: { ...openGraph, siteName: input.siteName, type: "website" as const, ...(image ? { images: [image] } : {}) } } : {}),
    ...(image ? { twitter: { card: "summary_large_image" as const, images: [image.url] } } : {}),
  };
}
