import type { MetadataRoute } from "next";
import { getSitemapEntries, toSitemapXmlEntries } from "@/lib/sitemap";

// SEO-1: built on request (never at build time, which has no database) from an in-process cache of one hour
// (lib/sitemap.ts). A database failure serves the last good list or the static pages, never a 500.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return toSitemapXmlEntries(await getSitemapEntries());
}
