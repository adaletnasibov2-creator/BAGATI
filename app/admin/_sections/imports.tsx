/** İdxallar (/admin/imports). Moved unchanged from app/admin/[...section]/page.tsx. */
import Link from "next/link";
import AdminProductImport from "@/components/admin-product-import";
import { Filters } from "@/components/admin-list-filters";
import { prisma } from "@/lib/prisma";
import { type SectionContext, Header, Table, Pager } from "./shared";
import { AdminStatusBadge } from "@/components/admin-ui/admin-status-badge";

export async function renderImports({ q, page, take, skip, pageQuery, shell }: SectionContext) {
  const where:any=q?{sourceName:{contains:q,mode:"insensitive"}}:{};
  const [rows,total]=await Promise.all([
   prisma.productImport.findMany({where,orderBy:{createdAt:"desc"},skip,take}),
   prisma.productImport.count({where}),
  ]);
  const storeIds=[...new Set(rows.map((row:any)=>row.storeId))];
  const stores=await prisma.store.findMany({where:{id:{in:storeIds}},select:{id:true,name:true}});
  const storeNames=new Map<string,string>(stores.map((store:any)=>[store.id,store.name] as [string,string]));
  return shell(<><Header title="İdxal tarixçəsi" detail="CSV/XLSX fayllar əvvəlcə yoxlanılır; yalnız seçilmiş mağazaya aid məhsullar yazılır."/><AdminProductImport/><Filters path="/admin/imports" q={q}/><Table rows={rows} columns={[{label:"Fayl",cell:r=>r.sourceName},{label:"Mağaza",cell:r=>{const name=storeNames.get(r.storeId);return name?<Link href={`/admin/stores/${r.storeId}`} className="text-[#173c40]">{name}</Link>:"Mağaza tapılmadı"}},{label:"Status",cell:r=><AdminStatusBadge kind="import" value={r.status}/>},{label:"Yaradılıb",cell:r=>r.createdAt.toLocaleString("az-AZ")},{label:"Nəticə",cell:r=><pre className="max-w-xs whitespace-pre-wrap text-xs">{JSON.stringify(r.result||{})}</pre>} ]}/><Pager path="/admin/imports" page={page} total={total} query={pageQuery}/></>);
}
