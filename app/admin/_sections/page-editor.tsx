/** Səhifə redaktəsi (/admin/pages/:slug): edit form, preview and history. Phase C1. */
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/admin-ui/page-header";
import { buttonClass } from "@/components/admin-ui/styles";
import AdminContentPageEditor from "@/components/admin-content-page-editor";
import { loadContentPageEditor } from "@/lib/content-pages-admin";
import { isContentPageSlug } from "@/lib/content-pages";
import { type SectionContext } from "./shared";

export async function renderPageEditor({ parts, shell }: SectionContext) {
  const slug = parts[1];
  if (!isContentPageSlug(slug)) notFound();
  const data = await loadContentPageEditor(prisma, slug);
  return shell(<>
    <PageHeader
      title={data.adminLabel}
      description={data.fromDatabase ? "Saytda bu mətn göstərilir. Yadda saxladıqda yeni versiya yaranır." : "Səhifə hələ redaktə olunmayıb: saytda əvvəlki mətn göstərilir. İlk yadda saxlama ilk versiyanı yaradır."}
      actions={<><Link href="/admin/pages" className={buttonClass("ghost")}>← Səhifələr</Link><a href={data.path} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary")}>Saytda bax</a></>}
    />
    <AdminContentPageEditor data={data} />
  </>);
}
