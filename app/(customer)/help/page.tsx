import type { Metadata } from "next";
import { ContentPageView } from "@/components/content-page-view";
import { getPublicContentPage } from "@/lib/content-pages";
import { absoluteSiteUrl } from "@/lib/category-seo";

// Text from /admin/pages (ContentPage "help"); the built-in text when the page was never saved.
export const dynamic = "force-dynamic";

// SEO-TITLES-1: <title> is the help page's own title (the same source as the visible heading: the published content
// page or its built-in title "Kömək mərkəzi"); the root template adds the site name. Plus the canonical URL.
export async function generateMetadata(): Promise<Metadata> {
  const page = await getPublicContentPage("help");
  const canonical = absoluteSiteUrl("/help");
  return { title: page.title, robots: { index: true, follow: true }, ...(canonical ? { alternates: { canonical } } : {}) };
}

export default function HelpPage() {
  return <ContentPageView slug="help" eyebrow="Məlumat" />;
}
