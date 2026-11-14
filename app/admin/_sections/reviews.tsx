/** Rəylər (/admin/reviews): list with delete. Moved unchanged from app/admin/[...section]/page.tsx. */
import AdminMutationForm from "@/components/admin-mutation-form";
import { Filters } from "@/components/admin-list-filters";
import { prisma } from "@/lib/prisma";
import { type SectionContext, Header, Table, Pager } from "./shared";

export async function renderReviews({ q, page, take, skip, pageQuery, shell }: SectionContext) {
  const where:any=q?{OR:[{comment:{contains:q,mode:"insensitive"}},{product:{name:{contains:q,mode:"insensitive"}}},{user:{email:{contains:q,mode:"insensitive"}}}]}:{};const [rows,total]=await Promise.all([prisma.review.findMany({where,include:{product:{include:{store:{select:{name:true}}}},user:{select:{email:true}}},orderBy:{createdAt:"desc"},skip,take}),prisma.review.count({where})]);return shell(<><Header title="Rəylər" detail="Moderasiya silmə əməliyyatı və audit qeydi yaradır."/><Filters path="/admin/reviews" q={q}/><Table rows={rows} columns={[{label:"Məhsul / mağaza",cell:r=><span>{r.product.name}<small className="block text-slate-500">{r.product.store.name}</small></span>},{label:"Müştəri",cell:r=>r.user.email},{label:"Reytinq",cell:r=>`${r.rating}/5`},{label:"Rəy",cell:r=>r.comment||"—"},{label:"Tarix / əməl",cell:r=><div>{r.createdAt.toLocaleDateString("az-AZ")}<AdminMutationForm resource="reviews" method="DELETE" className="mt-2" fields={[{name:"id",label:"",type:"hidden",value:r.id}]} button="Rəyi sil" confirmMessage="Bu rəyi silmək istədiyinizə əminsiniz?"/></div>} ]}/><Pager path="/admin/reviews" page={page} total={total} query={pageQuery}/></>);
}
