/** Kateqoriyalar (/admin/categories): two-level tree with counts, create/edit/move/reorder/activate/delete. */
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings/read";
import { SETTING_KEYS } from "@/lib/settings/registry";
import { PageHeader } from "@/components/admin-ui/page-header";
import { EmptyState } from "@/components/admin-ui/empty-state";
import { Filters } from "@/components/admin-list-filters";
import AdminCategoryManager, { type AdminCategoryNode } from "@/components/admin-category-manager";
import { buildCategoryTree, rollUpCategoryCounts, type CategoryRow } from "@/lib/category-tree";
import { countVisibleProductsByCategory } from "@/lib/public-category-tree";
import type { SectionContext } from "./shared";

export async function renderCategories({ q, shell }: SectionContext) {
  const [rows, visible, showEmptySetting] = await Promise.all([
    prisma.category.findMany({
      select: { id: true, name: true, slug: true, parentId: true, isActive: true, sortOrder: true, iconKey: true, imageUrl: true, _count: { select: { products: true, children: true } } },
    }),
    countVisibleProductsByCategory(prisma),
    getSetting<boolean>(SETTING_KEYS.catalogShowEmptyCategories),
  ]);
  const showEmpty = showEmptySetting !== false;
  const visibleTotals = rollUpCategoryCounts(rows, visible);
  const productTotals = rollUpCategoryCounts(rows, new Map(rows.map((row) => [row.id, row._count.products])));
  const withCounts = rows.map(({ _count, ...row }) => ({
    ...row,
    productCount: _count.products,
    totalCount: productTotals.get(row.id) ?? 0,
    childCount: _count.children,
    visibleCount: visibleTotals.get(row.id) ?? 0,
  }));
  const tree = buildCategoryTree(withCounts as (CategoryRow & Omit<AdminCategoryNode, "children" | keyof CategoryRow>)[]) as AdminCategoryNode[];
  const todo = tree.reduce((sum, top) => sum + (top.children.length ? top.productCount : 0), 0);
  // Search by name or slug: a top-level is shown with all its subcategories when it or any of them matches.
  const needle = q.trim().toLocaleLowerCase("az-AZ");
  const hit = (row: { name: string; slug: string }) => row.name.toLocaleLowerCase("az-AZ").includes(needle) || row.slug.includes(needle);
  const shown = needle ? tree.filter((top) => hit(top) || top.children.some(hit)) : tree;
  return shell(<>
    <PageHeader
      title="Kateqoriyalar"
      description={<>İki səviyyə: üst kateqoriya və alt kateqoriya. Mağazada yalnız aktiv və görünən məhsulu olan kateqoriyalar göstərilir; satıcılar hamısını seçə bilər.{todo > 0 && <> Alt kateqoriyası olan üst kateqoriyalarda hələ <b>{todo}</b> məhsul alt kateqoriyasızdır.</>}</>}
    />
    <p className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[#e7e3d9] bg-white px-4 py-3 text-sm text-slate-600">
      <span>Boş kateqoriyaları göstər: <b className="text-[#0d1b2a]">{showEmpty ? "Açıqdır — məhsulu olmayan aktiv kateqoriyalar da mağazada görünür" : "Söndürülüb — yalnız məhsulu olanlar görünür"}</b>.</span>
      <Link href="/admin/settings?tab=catalog" className="font-semibold text-[#173c40] underline-offset-2 hover:underline">Dəyiş</Link>
      <span className="text-slate-500">Deaktiv kateqoriyalar hər halda gizlidir.</span>
    </p>
    <Filters path="/admin/categories" q={q} />
    {shown.length ? <AdminCategoryManager tree={shown} /> : <EmptyState title="Kateqoriya tapılmadı" description="Axtarışı dəyişin və ya təmizləyin." />}
  </>);
}
