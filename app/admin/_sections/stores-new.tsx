/** Mağaza yarat (/admin/stores/new). Moved unchanged from app/admin/[...section]/page.tsx. */
import AdminMutationForm from "@/components/admin-mutation-form";
import { prisma } from "@/lib/prisma";
import { type SectionContext, card, Header } from "./shared";

export async function renderStoresNew({ shell }: SectionContext) {
  const [vendors,cities]=await Promise.all([prisma.vendorProfile.findMany({where:{user:{isActive:true}},include:{user:{select:{email:true}}},orderBy:{displayName:"asc"}}),prisma.city.findMany({where:{isActive:true},orderBy:{name:"asc"}})]);
  return shell(<><Header title="Mağaza yarat" detail="Admin mağazaları BASIC limitləri ilə abunəlik ödənişi tələb etmir. Aktiv seçim yalnız başlanğıc açarıdır; hüquqi yoxlama və admin təsdiqi olmadan mağaza ictimai satışa çıxmır."/><section className={`${card} max-w-3xl`}><AdminMutationForm resource="stores" fields={[{name:"name",label:"Mağaza adı",required:true},{name:"vendorId",label:"Satıcı",type:"select",required:true,options:vendors.map((v:any)=>({value:v.id,label:`${v.displayName} · ${v.user.email}`}))},{name:"cityId",label:"Şəhər",type:"select",required:true,options:cities.map((c:any)=>({value:c.id,label:c.name}))},{name:"address",label:"Ünvan"},{name:"description",label:"Təsvir",type:"textarea"},{name:"managementReason",label:"Admin idarəçiliyinin səbəbi",type:"textarea",required:true},{name:"isActive",label:"İlkin aktivlik (təsdiqə qədər satış bağlıdır)",type:"checkbox",value:false}]}/></section></>);
}
