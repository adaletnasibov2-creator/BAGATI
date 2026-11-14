/** Səhifələr (/admin/pages): the four content pages with their last update. Phase C1. */
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/admin-ui/page-header";
import { DataTable } from "@/components/admin-ui/data-table";
import { StatusBadge } from "@/components/admin-ui/status-badge";
import { buttonClass } from "@/components/admin-ui/styles";
import { listContentPages } from "@/lib/content-pages-admin";
import { formatContentDate } from "@/lib/content-pages";
import { type SectionContext } from "./shared";

export async function renderPages({ shell }: SectionContext) {
  const pages = await listContentPages(prisma);
  return shell(<>
    <PageHeader title="Səhifələr" description="İstifadə şərtləri, gizlilik siyasəti, haqqımızda və kömək mərkəzi. Hər yadda saxlama yeni versiya yaradır və audit jurnalına yazılır." />
    <DataTable rows={pages} rowKey={(page) => page.slug} caption="Məzmun səhifələri" columns={[
      { label: "Səhifə", cell: (page) => <span><Link href={`/admin/pages/${page.slug}`} className="font-semibold text-[#173c40] hover:underline">{page.adminLabel}</Link><small className="block text-slate-500">{page.path}</small></span> },
      { label: "Başlıq", cell: (page) => page.title },
      { label: "Son yenilənmə", cell: (page) => page.updatedAt ? <span>{formatContentDate(page.updatedAt)}{page.updatedBy && <small className="block text-slate-500">{page.updatedBy}</small>}</span> : <StatusBadge tone="neutral">Daxili mətn</StatusBadge> },
      { label: "Versiyalar", numeric: true, cell: (page) => page.revisions },
      { label: "Əməl", cell: (page) => <Link href={`/admin/pages/${page.slug}`} className={buttonClass("secondary")}>Redaktə et</Link> },
    ]} />
    <p className="mt-3 text-xs text-slate-500">&quot;Daxili mətn&quot;: səhifə hələ redaktə olunmayıb; saytda əvvəlki mətn göstərilir.</p>
  </>);
}
