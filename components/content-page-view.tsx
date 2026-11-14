import type { ReactNode } from "react";
import { ContentBody } from "@/lib/content-markup";
import { CONTENT_PAGE_META, formatContentDate, getPublicContentPage, type ContentPageSlug } from "@/lib/content-pages";

/**
 * Public content page (terms, privacy, about, help): the published database row, or the built-in text, in the card
 * style of the former hard-coded pages. "Son yenilənmə" is shown on terms and privacy when the page was saved.
 */
export async function ContentPageView({ slug, eyebrow, before }: { slug: ContentPageSlug; eyebrow?: string; before?: ReactNode }) {
  const page = await getPublicContentPage(slug);
  const showUpdated = CONTENT_PAGE_META[slug].showUpdatedAt && page.updatedAt;
  return <div className="container py-10 sm:py-14">
    <article className="mx-auto max-w-3xl rounded-[24px] border border-[#E5E9E5] bg-white p-6 shadow-[0_10px_28px_rgba(23,58,58,.05)] sm:p-10">
      {before}
      {eyebrow && <p className="text-xs font-semibold uppercase tracking-[.18em] text-[#85621d]">{eyebrow}</p>}
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#173A3A]">{page.title}</h1>
      <ContentBody body={page.body} className="mt-5 text-sm sm:text-base" />
      {showUpdated && <p className="mt-8 border-t border-[#E5E9E5] pt-4 text-xs text-[#697875]">Son yenilənmə: {formatContentDate(page.updatedAt!)}</p>}
    </article>
  </div>;
}
