/** Məhsullar (/admin/products): list. Moved from app/admin/[...section]/page.tsx; Phase B UI kit (PageHeader, responsive DataTable, empty state). */
import Link from "next/link";
import { categoriesWithOtherLast } from "@/lib/category-order";
import { normalizeAdminEnumFilter } from "@/lib/admin-pagination";
import { Filters, FilterSelect } from "@/components/admin-list-filters";
import { prisma } from "@/lib/prisma";
import { type SectionContext, productStatuses, Pager, StatusForm } from "./shared";
import { AdminStatusBadge } from "@/components/admin-ui/admin-status-badge";
import { adminStatusOptions } from "@/lib/admin-labels";
import { formatMoney } from "@/lib/format-money";
import { PageHeader } from "@/components/admin-ui/page-header";
import { DataTable } from "@/components/admin-ui/data-table";
import { buttonClass } from "@/components/admin-ui/styles";

export async function renderProducts({ sp, q, page, take, skip, pageQuery, shell }: SectionContext) {
  const productStatus=normalizeAdminEnumFilter(sp.status,productStatuses);const where:any={...(productStatus?{status:productStatus}:{}),...(sp.storeId?{storeId:sp.storeId}:{}),...(sp.categoryId?{categoryId:sp.categoryId}:{}),...(q?{OR:[{name:{contains:q,mode:"insensitive"}},{sku:{contains:q,mode:"insensitive"}},{store:{name:{contains:q,mode:"insensitive"}}}]}:{})};const [rows,total,stores,categoryRows]=await Promise.all([prisma.product.findMany({where,include:{store:{select:{id:true,name:true,vendor:{select:{displayName:true}}}},category:true,inventory:true},orderBy:{createdAt:"desc"},skip,take}),prisma.product.count({where}),prisma.store.findMany({orderBy:{name:"asc"},select:{id:true,name:true}}),prisma.category.findMany({orderBy:{name:"asc"},select:{id:true,name:true}})]);const categories=categoriesWithOtherLast(categoryRows as {id:string;name:string}[]);
  const exportQuery=new URLSearchParams(Object.entries({q,storeId:sp.storeId||"",categoryId:sp.categoryId||"",status:productStatus||""}).filter(([,value])=>value)).toString();
  return shell(<><PageHeader title="Məhsullar" actions={<Link href={`/api/admin/products/export${exportQuery?`?${exportQuery}`:""}`} className={buttonClass("secondary")}>Məhsulları CSV ixrac et</Link>}/><Filters path="/admin/products" q={q}><FilterSelect name="status" label="Status" values={adminStatusOptions("product",productStatuses)} selected={sp.status}/><FilterSelect name="storeId" label="Mağaza" values={stores} selected={sp.storeId}/><FilterSelect name="categoryId" label="Kateqoriya" values={categories} selected={sp.categoryId}/></Filters><DataTable rows={rows} rowKey={r=>r.id} empty="Məhsul tapılmadı." emptyDescription={q||sp.status||sp.storeId||sp.categoryId?"Filtrləri dəyişin və ya təmizləyin.":undefined} columns={[{label:"Məhsul",cell:r=><Link href={`/admin/products/${r.id}`} className="font-semibold text-[#173c40]">{r.name}</Link>},{label:"Mağaza / satıcı",cell:r=><span>{r.store.name}<small className="block text-slate-500">{r.store.vendor.displayName}</small></span>},{label:"Kateqoriya",cell:r=>r.category?.name||"—"},{label:"Qiymət / endirim",cell:r=>`${formatMoney(r.price)} / ${r.discountPrice?formatMoney(r.discountPrice):"—"}`},{label:"Stok",cell:r=>r.inventory.reduce((n:number,i:any)=>n+i.quantity,0)},{label:"Status",cell:r=><div><AdminStatusBadge kind="product" value={r.status}/>{r.status!=="ARCHIVED"&&<StatusForm resource="products" id={r.id} status={r.status} options={productStatuses} button="Saxla" confirm="Məhsul statusunu dəyişmək istəyirsiniz?"/>}</div>},{label:"Yaradılıb",cell:r=>r.createdAt.toLocaleDateString("az-AZ")} ]}/><Pager path="/admin/products" page={page} total={total} query={pageQuery}/></>);
}
