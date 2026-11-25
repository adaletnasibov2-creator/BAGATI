/** Məhsulları köçür (/admin/categories/move?from=<id>): move selected products of a category to a subcategory. */
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/admin-ui/page-header";
import { EmptyState } from "@/components/admin-ui/empty-state";
import { buttonClass, cardClass } from "@/components/admin-ui/styles";
import AdminCategoryProductMove from "@/components/admin-category-product-move";
import { MOVE_PRODUCTS_MAX } from "@/lib/admin-category-service";
import { buildCategoryTree } from "@/lib/category-tree";
import { adminStatusLabel } from "@/lib/admin-labels";
import type { SectionContext } from "./shared";

export async function renderCategoryProductMove({ sp, shell }: SectionContext) {
  const rows = await prisma.category.findMany({ select: { id: true, name: true, slug: true, parentId: true, isActive: true, sortOrder: true, iconKey: true, imageUrl: true, _count: { select: { products: true } } } });
  const tree = buildCategoryTree(rows);
  const from = sp.from ? rows.find((row) => row.id === sp.from) ?? null : null;
  const back = <Link href="/admin/categories" className={buttonClass("secondary")}>Kateqoriyalara qayıt</Link>;

  if (!from) {
    // To-do list: products still sitting on a top-level that has subcategories.
    const todo = tree.filter((top) => top.children.length && top._count.products > 0);
    return shell(<>
      <PageHeader title="Məhsulları köçür" description="Alt kateqoriyası olan üst kateqoriyalarda alt kateqoriyasız qalan məhsullar." actions={back} />
      {todo.length ? <ul className="grid gap-2">{todo.map((top) => <li key={top.id}><Link href={`/admin/categories/move?from=${encodeURIComponent(top.id)}`} className={`${cardClass} flex min-h-14 items-center justify-between gap-3 hover:bg-surface-page`}><span className="font-semibold">{top.name}</span><span className="text-sm text-amber-900">{top._count.products} məhsul alt kateqoriyasız →</span></Link></li>)}</ul>
        : <EmptyState title="Köçürüləcək məhsul yoxdur" description="Alt kateqoriyası olan üst kateqoriyalarda alt kateqoriyasız məhsul qalmayıb." />}
    </>);
  }

  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where: { categoryId: from.id },
      select: { id: true, name: true, sku: true, status: true, updatedAt: true, store: { select: { name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * MOVE_PRODUCTS_MAX,
      take: MOVE_PRODUCTS_MAX,
    }),
    prisma.product.count({ where: { categoryId: from.id } }),
  ]);
  const fromParent = from.parentId ? rows.find((row) => row.id === from.parentId) ?? null : null;
  // Targets: active subcategories (with an active parent); the source's own subcategories (or siblings) first.
  const homeId = from.parentId ?? from.id;
  const groups = tree
    .filter((top) => top.isActive)
    .sort((left, right) => Number(right.id === homeId) - Number(left.id === homeId))
    .map((top) => ({ id: top.id, name: top.name, options: top.children.filter((child) => child.isActive && child.id !== from.id).map((child) => ({ id: child.id, name: child.name })) }))
    .filter((group) => group.options.length);
  const pages = Math.max(1, Math.ceil(total / MOVE_PRODUCTS_MAX));
  return shell(<>
    <PageHeader
      title="Məhsulları köçür"
      description={<>Mənbə: <b>{fromParent ? `${fromParent.name} › ` : ""}{from.name}</b> · {total} məhsul. Seçilmiş məhsulların yalnız kateqoriyası dəyişir; bir əməliyyatda ən çox {MOVE_PRODUCTS_MAX} məhsul.</>}
      actions={back}
    />
    {products.length ? (
      <AdminCategoryProductMove
        fromCategoryId={from.id}
        groups={groups}
        products={products.map((product) => ({ id: product.id, name: product.name, sku: product.sku, status: adminStatusLabel("product", product.status), store: product.store.name, version: product.updatedAt.toISOString() }))}
      />
    ) : <EmptyState title="Bu kateqoriyada məhsul yoxdur" />}
    {pages > 1 && <nav aria-label="Səhifələr" className="mt-4 flex items-center justify-between text-sm"><span className="text-fg-secondary">Səhifə {page} / {pages}</span><span className="flex gap-2">{page > 1 && <Link className={buttonClass("secondary")} href={`/admin/categories/move?from=${encodeURIComponent(from.id)}&page=${page - 1}`}>Əvvəlki</Link>}{page < pages && <Link className={buttonClass("secondary")} href={`/admin/categories/move?from=${encodeURIComponent(from.id)}&page=${page + 1}`}>Növbəti</Link>}</span></nav>}
  </>);
}
