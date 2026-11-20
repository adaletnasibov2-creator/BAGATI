import type { ReactNode } from "react";
import { ContentBody } from "@/lib/content-markup";
import { CONTENT_PAGE_META, formatContentDate, getPublicContentPage, type ContentPageSlug } from "@/lib/content-pages";
import { LegalDocument } from "@/components/legal-document";

/**
 * Public content page (terms, privacy, about, help): the published database row, or the built-in text, in the shared
 * reading layout of the legal pages (DESIGN-T9). "Son yenilənmə" is shown on terms and privacy when the page was saved.
 */
export async function ContentPageView({ slug, eyebrow, before }: { slug: ContentPageSlug; eyebrow?: string; before?: ReactNode }) {
  const page = await getPublicContentPage(slug);
  const showUpdated = CONTENT_PAGE_META[slug].showUpdatedAt && page.updatedAt;
  return <LegalDocument title={page.title} kicker={eyebrow} after={showUpdated && <p className="mt-8 border-t border-line pt-4 text-xs text-fg-muted">Son yenilənmə: {formatContentDate(page.updatedAt!)}</p>}>
    {before}
    <ContentBody body={page.body} unstyled />
  </LegalDocument>;
}
