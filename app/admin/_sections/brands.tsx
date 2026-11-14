/** Brendlər (/admin/brands). Moved unchanged from app/admin/[...section]/page.tsx. */
import AdminMutationForm from "@/components/admin-mutation-form";
import { Filters } from "@/components/admin-list-filters";
import { prisma } from "@/lib/prisma";
import { type SectionContext, card, Header, Table, Pager } from "./shared";

export async function renderBrands({ q, page, take, skip, pageQuery, shell }: SectionContext) {
  const [rows,total]=await Promise.all([prisma.brand.findMany({where:q?{name:{contains:q,mode:"insensitive"}}:{},include:{_count:{select:{products:true}}},orderBy:{name:"asc"},skip,take}),prisma.brand.count({where:q?{name:{contains:q,mode:"insensitive"}}:{}})]);return shell(<><Header title="Brendlər" detail="Mövcud sxemdə brendlər üçün aktiv/deaktiv statusu yoxdur."/><section className={`${card} mb-5`}><h2 className="mb-3 font-semibold">Brend əlavə et</h2><AdminMutationForm resource="brands" fields={[{name:"name",label:"Brend adı",required:true}]}/></section><Filters path="/admin/brands" q={q}/><Table rows={rows} columns={[{label:"Brend",cell:r=>r.name},{label:"Məhsullar",cell:r=>r._count.products},{label:"Dəyişdir",cell:r=><AdminMutationForm resource="brands" method="PATCH" className="min-w-52" fields={[{name:"id",label:"",type:"hidden",value:r.id},{name:"name",label:"Yeni ad",value:r.name,required:true}]}/>} ]}/><Pager path="/admin/brands" page={page} total={total} query={pageQuery}/></>);
}
