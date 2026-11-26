/** Şəhərlər (/admin/cities). Moved unchanged from app/admin/[...section]/page.tsx. */
import AdminMutationForm from "@/components/admin-mutation-form";
// ADMIN-3-TODAY-1: the status control is one button that does what its label says (was an inverted checkbox).
import { AdminCityStatusButton } from "@/components/admin-city-status-button";
import { Filters } from "@/components/admin-list-filters";
import { prisma } from "@/lib/prisma";
import { type SectionContext, card, Header, Table, Pager } from "./shared";
import { adminSearchContains } from "@/lib/admin-list-where";

export async function renderCities({ q, page, take, skip, pageQuery, shell }: SectionContext) {
  const where:any=q?{name:adminSearchContains(q)}:{};const [rows,total]=await Promise.all([prisma.city.findMany({where,include:{_count:{select:{stores:true,addresses:true}}},orderBy:{name:"asc"},skip,take}),prisma.city.count({where})]);return shell(<><Header title="Şəhərlər"/><section className={`${card} mb-5`}><h2 className="mb-3 font-semibold">Şəhər əlavə et</h2><AdminMutationForm resource="cities" fields={[{name:"name",label:"Şəhər adı",required:true},{name:"slug",label:"Slug",required:true},{name:"countryCode",label:"Ölkə kodu",value:"AZ",required:true}]}/></section><Filters path="/admin/cities" q={q}/><Table rows={rows} columns={[{label:"Şəhər",cell:r=>r.name},{label:"Slug",cell:r=>r.slug},{label:"Redaktə",cell:r=><AdminMutationForm resource="cities" method="PATCH" className="min-w-52" fields={[{name:"id",label:"",type:"hidden",value:r.id},{name:"name",label:"Ad",value:r.name,required:true},{name:"slug",label:"Slug",value:r.slug,required:true},{name:"countryCode",label:"Kod",value:r.countryCode,required:true}]}/>},{label:"Mağaza / ünvan",cell:r=>`${r._count.stores} / ${r._count.addresses}`},{label:"Status",cell:r=><div><span>{r.isActive?"Aktiv":"Deaktiv"}</span><AdminCityStatusButton cityId={r.id} isActive={r.isActive}/></div>} ]}/><Pager path="/admin/cities" page={page} total={total} query={pageQuery}/></>);
}
