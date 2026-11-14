/** Satıcı hesabı yarat (/admin/vendors/new). Moved unchanged from app/admin/[...section]/page.tsx. */
import AdminMutationForm from "@/components/admin-mutation-form";
import { prisma } from "@/lib/prisma";
import { type SectionContext, card, Header } from "./shared";

export async function renderVendorsNew({ shell }: SectionContext) {
   const cities=await prisma.city.findMany({where:{isActive:true},orderBy:{name:"asc"},select:{id:true,name:true}});
   return shell(<><Header title="Satıcı hesabı yarat" detail="Yeni satıcı hesabı, onun hüquqi məlumatları və ilk mağazası eyni əməliyyatda yaradılır. Hüquqi təsdiq və mağaza yoxlaması tamamlanmadan mağaza ictimai satışa çıxmır."/><section className={`${card} max-w-4xl`}>
    <AdminMutationForm resource="vendors" button="Satıcı və mağaza yarat" confirmMessage="Bu şəxs üçün satıcı hesabı və mağaza yaradılsın?" fields={[
     {name:"firstName",label:"Ad",required:true},
     {name:"lastName",label:"Soyad",required:true},
     {name:"email",label:"E-poçt",type:"email",required:true},
     {name:"password",label:"İlkin parol (min. 12 simvol)",type:"password",required:true,placeholder:"Ən azı 12 simvol"},
     {name:"phone",label:"Telefon"},
     {name:"sellerType",label:"Satıcı növü",type:"select",required:true,options:[{value:"INDIVIDUAL_ENTREPRENEUR",label:"Fərdi sahibkar"},{value:"REGISTERED_COMPANY",label:"Qeydiyyatda olan şirkət"}]},
     {name:"legalName",label:"Biznesin rəsmi adı",required:true},
     {name:"voen",label:"VÖEN (10 rəqəm)",required:true,placeholder:"1234567890"},
     {name:"legalAddress",label:"Hüquqi ünvan (qeydiyyatda olan şirkət üçün məcburi)",type:"textarea"},
     {name:"storeName",label:"Mağaza adı",required:true},
     {name:"storeDescription",label:"Mağaza təsviri",type:"textarea"},
     {name:"cityId",label:"Şəhər",type:"select",required:true,options:cities.map((c:any)=>({value:c.id,label:c.name}))},
     {name:"storeAddress",label:"Faktiki ünvan (mağaza)"},
     {name:"contactPhone",label:"Mağaza WhatsApp / telefonu (məs. 055 123 45 67)"},
     {name:"contactEmail",label:"Mağaza bildiriş e-poçtu (alıcılara göstərilmir)",type:"email"},
     {name:"initialStatus",label:"İlkin mağaza statusu",type:"select",value:"DRAFT",options:[{value:"DRAFT",label:"Qaralama (satış bağlı)"},{value:"PENDING_REVIEW",label:"Yoxlamaya göndər"}]},
     {name:"adminManaged",label:"Admin tərəfindən idarə olunan mağaza (abunəlik ödənişi tələb olunmur)",type:"checkbox",value:false},
     {name:"managementReason",label:"Admin idarəçiliyinin səbəbi (yalnız admin-mağaza üçün)",type:"textarea"},
     {name:"internalNote",label:"Daxili qeyd (yalnız admin üçün)",type:"textarea"},
    ]}/>
    <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">Kateqoriya mağaza səviyyəsində deyil, məhsul səviyyəsində saxlanılır; ona görə burada kateqoriya seçilmir. E-poçt təsdiqi mövcud sistemə növbəyə qoyulur — SMTP konfiqurasiya olunmayıbsa, göndəriləcəyi zəmanət edilmir.</p>
   </section></>);
}
