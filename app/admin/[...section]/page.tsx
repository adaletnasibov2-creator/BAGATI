import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import AdminMutationForm, { type AdminField } from "@/components/admin-mutation-form";
import AdminStoreProfileForm from "@/components/admin-store-profile-form";
import AdminStoreActivationAction from "@/components/admin-store-activation-action";
import AdminStoreArchiveAction from "@/components/admin-store-archive-action";
import AdminStoreReadiness from "@/components/admin-store-readiness";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { summarizeDeliveredSales } from "@/lib/admin-sales-report";
import { summarizeMonthlyStoreSales } from "@/lib/store-monthly-sales";
import { formatLocalDateInput, parseLocalDateRange } from "@/lib/admin-report-dates";
import { allowedAdminOrderTransitions } from "@/lib/order-fulfillment";
import AdminSiteSettingsForm from "@/components/admin-site-settings-form";
import AdminSettingsTabs from "@/components/admin-settings-tabs";
import AdminSettingField from "@/components/admin-setting-field";
import { loadAdminSettingsGroup, loadSettingSummary } from "@/lib/settings/admin";
import { SETTING_KEYS } from "@/lib/settings/registry";
import { commissionRateToPercent } from "@/lib/commission-rules";
import AdminHomepageManager from "@/components/admin-homepage-manager";
import AdminProductEditForm from "@/components/admin-product-edit-form";
import AdminPromotionManager from "@/components/admin-promotion-manager";
import AdminSubscriptionManager from "@/components/admin-subscription-manager";
import AdminProductImport from "@/components/admin-product-import";
import { SITE_SETTINGS_DEFAULTS } from "@/lib/site-content";
import { categoriesWithOtherLast } from "@/lib/category-order";
import { normalizeAdminEnumFilter, normalizeAdminPage, normalizeAdminSearch, normalizeAdminSearchParams } from "@/lib/admin-pagination";
import { missingSellerLegalFields } from "@/lib/seller-legal-policy";
import { complimentaryFromRows, resolveStoreEntitlements } from "@/lib/subscription-entitlements";
import { complimentaryGrantView, complimentaryHistorySelect } from "@/lib/complimentary-entitlements";
import AdminComplimentaryManager from "@/components/admin-complimentary-manager";
import { buildAdminStoreReadiness } from "@/lib/admin-store-readiness";
import { storeProfileOptions, toAdminStoreProfileView } from "@/lib/admin-store-profile";
import { Filters, FilterSelect } from "@/components/admin-list-filters";
import { adminOrderStatusWhere, ADMIN_PENDING_ORDER_GROUP } from "@/lib/admin-order-filters";

import { type SectionContext, card, storeStatuses, orderStatuses, productStatuses, Header, formatStoreCityName, formatSubscriptionSummary, Table, Pager, StatusForm } from "../_sections/shared";
import { ADMIN_SECTIONS } from "../_sections";

export const dynamic="force-dynamic";
const db:any=prisma;

export default async function AdminSectionPage({params,searchParams}:{params:Promise<{section:string[]}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const admin=await requireRole("ADMIN");if(!admin)redirect("/admin/login");
 const [{section:parts},rawSearchParams]=await Promise.all([params,searchParams]);const sp=normalizeAdminSearchParams(rawSearchParams);const route=parts.join("/");const q=normalizeAdminSearch(sp.q);const page=normalizeAdminPage(sp.page);const take=25,skip=(page-1)*take;const pageQuery=new URLSearchParams(Object.entries(sp).filter(([k,v])=>k!=="page"&&Boolean(v)) as [string,string][]).toString();
 const shell=(content:React.ReactNode)=><AdminShell email={admin.email}>{content}</AdminShell>;
 // Sections moved to app/admin/_sections/* (original order); the branches below are not moved yet.
 const ctx:SectionContext={admin,parts,route,sp,q,page,take,skip,pageQuery,shell};
 for(const section of ADMIN_SECTIONS)if(section.match(route,parts))return section.render(ctx);

 if(route==="settings"){
  // Settings-engine tabs (Maliyyə, SEO, Elan zolağı, Limitlər): one generic page per registry group.
  const engineTab=(["finance","seo","announcement","limits"] as const).find(tab=>tab===sp.tab);
  if(engineTab){
   const group=await loadAdminSettingsGroup(prisma,engineTab);
   return shell(<><Header title="Sayt parametrləri" detail={group.group.description}/><AdminSettingsTabs active={engineTab}/><div className="grid gap-4">{group.settings.map(view=><AdminSettingField key={view.key} view={view}/>)}</div></>);
  }
  const settings=await db.siteSettings.findUnique({where:{id:SITE_SETTINGS_DEFAULTS.id}});
  return shell(<><Header title="Sayt parametrləri" detail="Dəyişikliklər ictimai header, əlaqə məlumatları, qaydalar və ana səhifə təqdimatında görünür."/><AdminSettingsTabs active="general"/><AdminSiteSettingsForm initial={settings??SITE_SETTINGS_DEFAULTS}/></>);
 }

 if(route==="stores/new"){
  const [vendors,cities]=await Promise.all([db.vendorProfile.findMany({where:{user:{isActive:true}},include:{user:{select:{email:true}}},orderBy:{displayName:"asc"}}),db.city.findMany({where:{isActive:true},orderBy:{name:"asc"}})]);
  return shell(<><Header title="Mağaza yarat" detail="Admin mağazaları BASIC limitləri ilə abunəlik ödənişi tələb etmir. Aktiv seçim yalnız başlanğıc açarıdır; hüquqi yoxlama və admin təsdiqi olmadan mağaza ictimai satışa çıxmır."/><section className={`${card} max-w-3xl`}><AdminMutationForm resource="stores" fields={[{name:"name",label:"Mağaza adı",required:true},{name:"vendorId",label:"Satıcı",type:"select",required:true,options:vendors.map((v:any)=>({value:v.id,label:`${v.displayName} · ${v.user.email}`}))},{name:"cityId",label:"Şəhər",type:"select",required:true,options:cities.map((c:any)=>({value:c.id,label:c.name}))},{name:"address",label:"Ünvan"},{name:"description",label:"Təsvir",type:"textarea"},{name:"managementReason",label:"Admin idarəçiliyinin səbəbi",type:"textarea",required:true},{name:"isActive",label:"İlkin aktivlik (təsdiqə qədər satış bağlıdır)",type:"checkbox",value:false}]}/></section></>);
 }
  if(route==="vendors/new"){
   const cities=await db.city.findMany({where:{isActive:true},orderBy:{name:"asc"},select:{id:true,name:true}});
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


 if(route==="stores"){
  const storeStatus=normalizeAdminEnumFilter(sp.status,storeStatuses);const where:any={...(storeStatus?{status:storeStatus}:{NOT:{status:"SUSPENDED",isActive:false}}),...(sp.cityId?{cityId:sp.cityId}:{}),...(sp.vendorId?{vendorId:sp.vendorId}:{}),...(q?{OR:[{name:{contains:q,mode:"insensitive"}},{slug:{contains:q,mode:"insensitive"}},{vendor:{displayName:{contains:q,mode:"insensitive"}}},{vendor:{user:{email:{contains:q,mode:"insensitive"}}}}]}:{})};
  const [rows,total,cities,vendors]=await Promise.all([db.store.findMany({where,select:{id:true,name:true,status:true,isActive:true,legalInfoApproved:true,adminManaged:true,city:{select:{name:true,isActive:true}},vendor:{select:{displayName:true,user:{select:{email:true}}}},subscription:{select:{status:true,plan:{select:{name:true}}}},_count:{select:{products:true,storeOrders:true}}},orderBy:{createdAt:"desc"},skip,take}),db.store.count({where}),db.city.findMany({orderBy:{name:"asc"},select:{id:true,name:true}}),db.vendorProfile.findMany({orderBy:{displayName:"asc"},select:{id:true,displayName:true,user:{select:{email:true}}}})]);
  const vendorOptions=vendors.map((vendor:any)=>({id:vendor.id,name:`${vendor.displayName} · ${vendor.user.email}`}));
  return shell(<><Header title="Mağazalar" detail="İctimai görünürlük mağaza aktivliyindən, satış hüququ isə ayrıca hüquqi baxış və abunəlik qaydalarından asılıdır."/><div className="mb-4"><Link className="rounded-lg bg-[#173c40] px-4 py-2.5 text-sm font-semibold text-white" href="/admin/stores/new">+ Mağaza yarat</Link></div><Filters path="/admin/stores" q={q}><FilterSelect name="status" label="Status" values={storeStatuses.map(s=>({id:s,name:s}))} selected={sp.status}/><FilterSelect name="cityId" label="Şəhər" values={cities} selected={sp.cityId}/><FilterSelect name="vendorId" label="Satıcı" values={vendorOptions} selected={sp.vendorId}/></Filters><Table rows={rows} columns={[{label:"Mağaza",cell:r=><Link className="font-semibold text-[#173c40] hover:underline" href={`/admin/stores/${r.id}`}>{r.name}</Link>},{label:"Satıcı",cell:r=><span>{r.vendor?.displayName || "Satıcı yoxdur"}<small className="block text-slate-500">{r.vendor?.user?.email || "E-poçt yoxdur"}</small></span>},{label:"Şəhər",cell:r=>formatStoreCityName(r.city)},{label:"Status / görünürlük",cell:r=><span>{r.status} · {r.status === "ACTIVE" && r.isActive ? "ictimai görünür" : "ictimai gizlidir"}</span>},{label:"İdarəetmə / plan",cell:r=>r.adminManaged?"Admin tərəfindən · ödənişsiz":formatSubscriptionSummary(r.subscription)},{label:"Məhsul / sifariş",cell:r=>`${r._count.products} / ${r._count.storeOrders}`},{label:"İdarəetmə",cell:r=><div className="flex flex-wrap items-start gap-2"><AdminStoreActivationAction storeId={r.id} status={r.status} isActive={r.isActive} legalInfoApproved={r.legalInfoApproved}/><AdminStoreArchiveAction storeId={r.id} storeName={r.name} redirectToList={false} compact showArchive={false}/></div>} ]}/><Pager path="/admin/stores" page={page} total={total} query={pageQuery}/></>);
 }

 if(parts[0]==="stores"&&parts.length===2){const id=parts[1];const store=await db.store.findUnique({where:{id},select:{id:true,name:true,slug:true,description:true,logoUrl:true,bannerUrl:true,status:true,isActive:true,legalInfoApproved:true,adminManaged:true,managementReason:true,address:true,contactPhone:true,contactEmail:true,latitude:true,longitude:true,mapUrl:true,createdAt:true,vendorId:true,cityId:true,freeDeliveryThreshold:true,deliveryFee:true,city:{select:{name:true,isActive:true}},managedByAdmin:{select:{email:true}},vendor:{select:{id:true,displayName:true,sellerType:true,legalName:true,voen:true,legalAddress:true,user:{select:{id:true,email:true,isActive:true,createdAt:true}}}},subscription:{select:{id:true,status:true,currentPeriodStart:true,currentPeriodEnd:true,plan:{select:{id:true,name:true,monthlyPrice:true,slug:true,isActive:true}}}},complimentaryEntitlements:complimentaryHistorySelect,products:{take:12,orderBy:{createdAt:"desc"},include:{inventory:true}},storeOrders:{take:12,orderBy:{createdAt:"desc"},select:{id:true,orderId:true,status:true,subtotal:true,order:{select:{createdAt:true,total:true}},_count:{select:{items:true}}}}}});if(!store)notFound();const [productCount,activeProductCount,categoryLinkedProductCount]=await Promise.all([db.product.count({where:{storeId:id}}),db.product.count({where:{storeId:id,status:"ACTIVE"}}),db.product.count({where:{storeId:id,status:"ACTIVE",categoryId:{not:null}}})]);const readinessItems=buildAdminStoreReadiness({name:store.name,slug:store.slug,description:store.description,logoUrl:store.logoUrl,bannerUrl:store.bannerUrl,contactPhone:store.contactPhone,contactEmail:store.contactEmail,address:store.address,cityName:store.city?.name??null,cityActive:Boolean(store.city?.isActive),vendorActive:Boolean(store.vendor?.user?.isActive),sellerType:store.vendor?.sellerType??null,legalName:store.vendor?.legalName??null,voen:store.vendor?.voen??null,legalAddress:store.vendor?.legalAddress??null,legalInfoApproved:store.legalInfoApproved,adminManaged:store.adminManaged,storeStatus:store.status,storeActive:store.isActive,subscription:store.subscription?{status:store.subscription.status,periodStart:store.subscription.currentPeriodStart,periodEnd:store.subscription.currentPeriodEnd,planSlug:store.subscription.plan?.slug??"",planActive:store.subscription.plan?.isActive??false}:null,complimentary:complimentaryFromRows((store.complimentaryEntitlements||[]).filter((row:any)=>!row.revokedAt)),productCount,activeProductCount,categoryLinkedProductCount},{missingSellerLegalFields,resolveStoreEntitlements});const [storeNotifications,storeAudit,storeSales,activeCities,activeVendors]=await Promise.all([db.notification.findMany({where:{storeId:id},orderBy:{createdAt:"desc"},take:10,select:{id:true,title:true,body:true,createdAt:true,readAt:true}}),db.auditLog.findMany({where:{entityType:"Store",entityId:id},orderBy:{createdAt:"desc"},take:15,include:{actor:{select:{email:true}}}}),db.storeOrder.aggregate({where:{storeId:id,status:"DELIVERED"},_sum:{subtotal:true},_count:{_all:true}}),db.city.findMany({where:{isActive:true},orderBy:{name:"asc"},select:{id:true,name:true}}),db.vendorProfile.findMany({where:{user:{isActive:true}},orderBy:{displayName:"asc"},select:{id:true,displayName:true,user:{select:{email:true}}}})]);
  // Server-built options (no late client fetch): the current owner and city are always present, so the form shows them.
  const vendorOptions=storeProfileOptions(activeVendors.map((v:any)=>({id:v.id,name:`${v.displayName} · ${v.user.email}`})),store.vendor?{id:store.vendor.id,name:`${store.vendor.displayName} · ${store.vendor.user?.email??""}`}:null);
  const cityOptions=storeProfileOptions(activeCities,store.city?{id:store.cityId,name:store.city.name}:null);const vendorDisplayName=store.vendor?.displayName || "Satıcı adı yoxdur";const vendorEmail=store.vendor?.user?.email || "E-poçt yoxdur";const subscriptionSummary=store.subscription ? (store.subscription.plan?.name ? `${store.subscription.plan.name} · ${Number(store.subscription.plan.monthlyPrice).toFixed(2)} ₼/ay` : `${store.subscription.status || "Abunəlik"}`) : "Abunəlik qeydiyyatı yoxdur";return shell(<><Header title={store.name} detail={`${store.city?.name || "Şəhər yoxdur"} · Mağaza #${store.id}`}/><AdminStoreProfileForm store={toAdminStoreProfileView(store)} vendorOptions={vendorOptions} cityOptions={cityOptions}/><AdminStoreReadiness items={readinessItems} storeName={store.name} storeId={store.id}/><AdminComplimentaryManager storeId={store.id} grants={(store.complimentaryEntitlements||[]).map(complimentaryGrantView)}/><div className="grid gap-5 xl:grid-cols-2"><section className={card}><h2 className="font-semibold">Mağaza məlumatları</h2>{store.adminManaged&&<div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950"><b>Admin tərəfindən idarə olunur · abunəlik ödənişi tələb olunmur</b><p className="mt-1">Yaradan: {store.managedByAdmin?.email||"Admin hesabı silinib"}</p><p className="mt-1">Səbəb: {store.managementReason}</p></div>}<dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><dt className="text-slate-500">Status</dt><dd>{store.status}</dd><dt className="text-slate-500">İctimai görünürlük</dt><dd>{store.status === "ACTIVE" && store.isActive ? "Aktivdir" : "Deaktivdir"}</dd><dt className="text-slate-500">Hüquqi baxış</dt><dd>{store.legalInfoApproved ? "Təsdiqlənib" : "Tamamlanmayıb"}</dd><dt className="text-slate-500">Ünvan</dt><dd>{store.address||"—"}</dd><dt className="text-slate-500">Əlaqə</dt><dd>{store.contactPhone||"—"} · {store.contactEmail||"—"}</dd><dt className="text-slate-500">Koordinatlar</dt><dd>{store.latitude??"—"}, {store.longitude??"—"}</dd><dt className="text-slate-500">Xəritə</dt><dd>{store.mapUrl||"—"}</dd><dt className="text-slate-500">Yaradılıb</dt><dd>{store.createdAt.toLocaleDateString("az-AZ")}</dd></dl><div className="mt-5 border-t pt-4"><h3 className="mb-3 text-sm font-semibold">Statusu dəyiş</h3><StatusForm resource="stores" id={store.id} status={store.status} options={storeStatuses} button="Statusu yadda saxla" confirm="Mağaza statusunu dəyişmək istədiyinizə əminsiniz?" isActive={store.isActive} legalInfoApproved={store.legalInfoApproved}/></div></section><section className={card}><h2 className="font-semibold">Satıcı və abunəlik</h2>{store.vendor ? <Link href={`/admin/vendors/${store.vendor.id}`} className="mt-3 inline-block font-medium text-[#173c40]">{vendorDisplayName} · {vendorEmail}</Link> : <p className="mt-3 text-sm text-slate-500">Satıcı məlumatı yoxdur.</p>}<p className="mt-1 text-sm text-slate-500">Hesab: {store.vendor?.user?.isActive ? "Aktiv" : "Deaktiv"} · {store.vendor?.user?.createdAt ? store.vendor.user.createdAt.toLocaleDateString("az-AZ") : "Məlumat yoxdur"}</p>{store.subscription?<div className="mt-5 rounded-xl bg-[#f8f7f4] p-4"><b>{subscriptionSummary}</b><p className="mt-1 text-sm text-slate-500">{store.subscription.status} · {store.subscription.currentPeriodStart?.toLocaleDateString("az-AZ")||"Başlanmayıb"} – {store.subscription.currentPeriodEnd?.toLocaleDateString("az-AZ")||"—"}</p></div>:<p className="mt-4 text-sm text-slate-500">Abunəlik qeydiyyatı yoxdur.</p>}<div className="mt-5 border-t pt-4"><p className="mb-3 text-xs text-amber-800">Admin abunəlik statusunu əl ilə dəyişə bilər. Bu əməliyyat ödəniş provayderi təsdiqi deyil.</p><Link href="/admin/subscriptions" className="inline-flex rounded-lg bg-[#173c40] px-3 py-2 text-sm font-semibold text-white">Abunəlikləri idarə et</Link></div></section></div><section className="mt-5"><h2 className="mb-3 text-lg font-semibold">Məhsullar</h2>{store.products.some((product:any)=>product.status==="DRAFT")&&<p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">Mağaza aktivləşdiriləndə yayımlanma tələblərinə cavab verən qaralama məhsullar avtomatik yayımlanır. Yayımlanmayan məhsullar üçün nəticədə dəqiq səbəb və redaktə keçidi göstərilir; arxiv məhsulları avtomatik yayımlanmır.</p>}<Table rows={store.products} columns={[{label:"Məhsul",cell:r=><Link href={`/admin/products/${r.id}`} className="font-medium text-[#173c40]">{r.name}</Link>},{label:"Qiymət",cell:r=>`${Number(r.price).toFixed(2)} ₼`},{label:"Status",cell:r=>r.status},{label:"Stok",cell:r=>r.inventory.reduce((n:number,x:any)=>n+x.quantity,0)}]}/></section><section className="mt-5"><h2 className="mb-3 text-lg font-semibold">Son sifarişlər</h2><Table rows={store.storeOrders} columns={[{label:"Sifariş",cell:r=><Link href={`/admin/orders/${r.orderId}`} className="text-[#173c40]">#{r.orderId.slice(-8)}</Link>},{label:"Status",cell:r=>r.status},{label:"Məbləğ",cell:r=>`${Number(r.subtotal).toFixed(2)} ₼`},{label:"Tarix",cell:r=>r.order.createdAt.toLocaleDateString("az-AZ")}]} empty="Mağazaya aid sifariş yoxdur."/></section><section className="mt-5 grid gap-5 xl:grid-cols-2"><div className={card}><h2 className="font-semibold">Çatdırılmış satış</h2><p className="mt-3 text-sm">Çatdırılmış mağaza sifarişləri: {storeSales._count._all}</p><p className="mt-1 text-xl font-semibold">{Number(storeSales._sum.subtotal||0).toFixed(2)} AZN</p><p className="mt-2 text-xs text-slate-500">Bu göstərici çatdırılmış mağaza sifarişlərinin ümumi ara cəmidir; geri ödənişlər çıxılmayıb. Geri ödəniş düzəlişli satış və komissiya üçün <Link href="/admin/reports" className="font-medium text-[#173c40] underline">aylıq hesabat bölməsinə</Link> baxın.</p></div><div className={card}><h2 className="font-semibold">Mağaza bildirişləri</h2>{storeNotifications.length?storeNotifications.map((item:any)=><div key={item.id} className="border-b py-3 last:border-0"><b className="text-sm">{item.title}</b><p className="mt-1 text-sm text-slate-600">{item.body}</p><p className="mt-1 text-xs text-slate-400">{item.createdAt.toLocaleString("az-AZ")} {item.readAt?"· Oxunub":"· Oxunmayıb"}</p></div>):<p className="mt-3 text-sm text-slate-500">Mağaza bildirişi yoxdur.</p>}</div></section><section className="mt-5 rounded-2xl border border-[#e7e3d9] bg-white p-5"><h2 className="font-semibold">Mağaza audit tarixçəsi</h2>{storeAudit.length?storeAudit.map((item:any)=><div key={item.id} className="flex flex-wrap justify-between gap-2 border-b py-3 text-sm last:border-0"><span>{item.action} · {item.actor?.email||"Sistem"}</span><span className="text-slate-500">{item.createdAt.toLocaleString("az-AZ")}</span></div>):<p className="mt-3 text-sm text-slate-500">Audit qeydi yoxdur.</p>}</section></>)}

 if(route==="vendors"){
  const where:any=q?{OR:[{displayName:{contains:q,mode:"insensitive"}},{user:{email:{contains:q,mode:"insensitive"}}}]}:{};const [rows,total]=await Promise.all([db.vendorProfile.findMany({where,include:{user:{select:{id:true,email:true,isActive:true,createdAt:true}},stores:{select:{id:true,status:true,isActive:true,subscription:{select:{status:true}}}}},orderBy:{user:{createdAt:"desc"}},skip,take}),db.vendorProfile.count({where})]);
  return shell(<><Header title="Satıcılar" detail="Satıcı hesabları, onların mağazaları və abunəlik vəziyyəti."/><div className="mb-4"><Link className="rounded-lg bg-[#173c40] px-4 py-2.5 text-sm font-semibold text-white" href="/admin/vendors/new">+ Satıcı hesabı yarat</Link></div><Filters path="/admin/vendors" q={q}/><Table rows={rows} columns={[{label:"Satıcı",cell:r=><Link href={`/admin/vendors/${r.id}`} className="font-semibold text-[#173c40]">{r.displayName}</Link>},{label:"E-poçt",cell:r=>r.user.email},{label:"Mağazalar",cell:r=>r.stores.length},{label:"Aktiv",cell:r=>r.stores.filter((s:any)=>s.isActive).length},{label:"Abunəliklər",cell:r=>r.stores.map((s:any)=>s.subscription?.status||"yoxdur").join(", ")||"—"},{label:"Qeydiyyat",cell:r=>r.user.createdAt.toLocaleDateString("az-AZ")} ]}/><Pager path="/admin/vendors" page={page} total={total} query={pageQuery}/></>);
 }
 if (parts[0] === "vendors" && parts.length === 2) {
   const vendorId = parts[1];
   const vendor = await prisma.vendorProfile.findUnique({
    where: { id: vendorId },
    select: {
     id: true,
     displayName: true,
     user: { select: { id: true, email: true, isActive: true, createdAt: true } },
     _count: { select: { stores: true } },
     stores: {
      take: 50,
      orderBy: { createdAt: "desc" },
      select: {
       id: true,
       name: true,
       status: true,
       isActive: true,
       city: { select: { name: true } },
       subscription: {
        select: {
         status: true,
         currentPeriodStart: true,
         currentPeriodEnd: true,
         plan: { select: { name: true } },
        },
       },
       _count: { select: { products: true, storeOrders: true } },
      },
     },
    },
   });
   if (!vendor) notFound();
   return shell(<>
    <Header title={vendor.displayName || "Satıcı adı yoxdur"} detail={vendor.user.email + " · Satıcı hesabı"}/>
    <section className={card + " mb-5"}>
     <p>Hesab statusu: <b>{vendor.user.isActive ? "Aktiv" : "Deaktiv"}</b> · Qeydiyyat: {vendor.user.createdAt.toLocaleDateString("az-AZ")}</p>
     <AdminMutationForm resource="users" method="PATCH" fields={[{name:"id",label:"",type:"hidden",value:vendor.user.id},{name:"isActive",label:vendor.user.isActive?"Hesabı deaktiv et":"Hesabı aktiv et",type:"checkbox",value:!vendor.user.isActive}]} button="Hesab statusunu dəyiş" confirmMessage="Satıcı hesabının statusunu dəyişmək istəyirsiniz?"/>
    </section>
    <h2 className="mb-3 font-semibold">Mağazalar ({vendor.stores.length} / {vendor._count.stores})</h2>
    <Table rows={vendor.stores} empty="Bu satıcıya aid mağaza yoxdur." columns={[
     {label:"Mağaza",cell:r=><Link href={"/admin/stores/" + r.id} className="font-semibold text-[#173c40]">{r.name}</Link>},
     {label:"Şəhər",cell:r=>r.city?.name || "Şəhər yoxdur"},
     {label:"Status / görünürlük",cell:r=>r.status + " · " + (r.status === "ACTIVE" && r.isActive ? "ictimai görünür" : "ictimai gizlidir")},
     {label:"Abunəlik",cell:r=>r.subscription ? (r.subscription.plan?.name || "Plan yoxdur") + " · " + r.subscription.status : "Abunəlik yoxdur"},
     {label:"Məhsul / sifariş",cell:r=>r._count.products + " / " + r._count.storeOrders},
    ]}/>
    {vendor._count.stores > vendor.stores.length && <p className="mt-3 text-xs text-slate-500">Siyahıda ən son 50 mağaza göstərilir.</p>}
   </>);
  }

 if(route==="customers"){
  const where:any={role:"CUSTOMER",...(sp.status==="active"?{isActive:true}:sp.status==="inactive"?{isActive:false}:{}),...(q?{OR:[{email:{contains:q,mode:"insensitive"}},{customerProfile:{firstName:{contains:q,mode:"insensitive"}}},{customerProfile:{lastName:{contains:q,mode:"insensitive"}}}]}:{})};const [rows,total]=await Promise.all([db.user.findMany({where,include:{customerProfile:true,_count:{select:{orders:true}}},orderBy:{createdAt:"desc"},skip,take}),db.user.count({where})]);
  return shell(<><Header title="Müştərilər" detail="Şəxsi məlumatlar yalnız admin səlahiyyəti ilə göstərilir."/><Filters path="/admin/customers" q={q}><FilterSelect name="status" label="Hesab" values={[{id:"active",name:"Aktiv"},{id:"inactive",name:"Deaktiv"}]} selected={sp.status}/></Filters><Table rows={rows} columns={[{label:"Müştəri",cell:r=><Link href={`/admin/customers/${r.id}`} className="font-semibold text-[#173c40]">{[r.customerProfile?.firstName,r.customerProfile?.lastName].filter(Boolean).join(" ")||r.email}</Link>},{label:"E-poçt",cell:r=>r.email},{label:"Telefon",cell:r=>r.customerProfile?.phone||"—"},{label:"Sifarişlər",cell:r=>r._count.orders},{label:"Status",cell:r=>r.isActive?"Aktiv":"Deaktiv"},{label:"Qeydiyyat",cell:r=>r.createdAt.toLocaleDateString("az-AZ")} ]}/><Pager path="/admin/customers" page={page} total={total} query={pageQuery}/></>);
 }
 if(parts[0]==="customers"&&parts.length===2){const user=await db.user.findFirst({where:{id:parts[1],role:"CUSTOMER"},include:{customerProfile:true,addresses:{include:{city:true}},_count:{select:{orders:true}}}});if(!user)notFound();return shell(<><Header title="Müştəri məlumatı" detail={user.email}/><section className={`${card} mb-5`}><div className="grid gap-3 text-sm sm:grid-cols-2"><p>Ad: {user.customerProfile?.firstName||"—"} {user.customerProfile?.lastName||""}</p><p>Telefon: {user.customerProfile?.phone||"—"}</p><p>Hesab: {user.isActive?"Aktiv":"Deaktiv"}</p><p>Sifariş sayı: {user._count.orders}</p><p>Qeydiyyat: {user.createdAt.toLocaleDateString("az-AZ")}</p></div><AdminMutationForm resource="users" method="PATCH" className="mt-4" fields={[{name:"id",label:"",type:"hidden",value:user.id},{name:"isActive",label:user.isActive?"Hesabı deaktiv et":"Hesabı aktiv et",type:"checkbox",value:!user.isActive}]} button="Statusu dəyiş" confirmMessage="Müştəri hesabının statusunu dəyişmək istəyirsiniz?"/></section><h2 className="mb-3 font-semibold">Çatdırılma ünvanları</h2><div className="grid gap-3 sm:grid-cols-2">{user.addresses.map((a:any)=><article key={a.id} className={card}><b>{a.label||a.recipientName}</b><p className="mt-2 text-sm text-slate-500">{a.line1} {a.line2||""} · {a.city.name}</p></article>)}</div></>)}

 if(route==="products"){
  const productStatus=normalizeAdminEnumFilter(sp.status,productStatuses);const where:any={...(productStatus?{status:productStatus}:{}),...(sp.storeId?{storeId:sp.storeId}:{}),...(sp.categoryId?{categoryId:sp.categoryId}:{}),...(q?{OR:[{name:{contains:q,mode:"insensitive"}},{sku:{contains:q,mode:"insensitive"}},{store:{name:{contains:q,mode:"insensitive"}}}]}:{})};const [rows,total,stores,categoryRows]=await Promise.all([db.product.findMany({where,include:{store:{select:{id:true,name:true,vendor:{select:{displayName:true}}}},category:true,inventory:true},orderBy:{createdAt:"desc"},skip,take}),db.product.count({where}),db.store.findMany({orderBy:{name:"asc"},select:{id:true,name:true}}),db.category.findMany({orderBy:{name:"asc"},select:{id:true,name:true}})]);const categories=categoriesWithOtherLast(categoryRows as {id:string;name:string}[]);
  const exportQuery=new URLSearchParams(Object.entries({q,storeId:sp.storeId||"",categoryId:sp.categoryId||"",status:productStatus||""}).filter(([,value])=>value)).toString();
  return shell(<><Header title="Məhsullar"/><div className="mb-4"><Link href={`/api/admin/products/export${exportQuery?`?${exportQuery}`:""}`} className="inline-flex min-h-10 items-center rounded-xl border border-[#173c40] px-4 py-2 text-sm font-semibold text-[#173c40]">Məhsulları CSV ixrac et</Link></div><Filters path="/admin/products" q={q}><FilterSelect name="status" label="Status" values={productStatuses.map(s=>({id:s,name:s}))} selected={sp.status}/><FilterSelect name="storeId" label="Mağaza" values={stores} selected={sp.storeId}/><FilterSelect name="categoryId" label="Kateqoriya" values={categories} selected={sp.categoryId}/></Filters><Table rows={rows} columns={[{label:"Məhsul",cell:r=><Link href={`/admin/products/${r.id}`} className="font-semibold text-[#173c40]">{r.name}</Link>},{label:"Mağaza / satıcı",cell:r=><span>{r.store.name}<small className="block text-slate-500">{r.store.vendor.displayName}</small></span>},{label:"Kateqoriya",cell:r=>r.category?.name||"—"},{label:"Qiymət / endirim",cell:r=>`${Number(r.price).toFixed(2)} / ${r.discountPrice?Number(r.discountPrice).toFixed(2):"—"} ₼`},{label:"Stok",cell:r=>r.inventory.reduce((n:number,i:any)=>n+i.quantity,0)},{label:"Status",cell:r=><div><span>{r.status}</span>{r.status!=="ARCHIVED"&&<StatusForm resource="products" id={r.id} status={r.status} options={productStatuses} button="Saxla" confirm="Məhsul statusunu dəyişmək istəyirsiniz?"/>}</div>},{label:"Yaradılıb",cell:r=>r.createdAt.toLocaleDateString("az-AZ")} ]}/><Pager path="/admin/products" page={page} total={total} query={pageQuery}/></>);
 }
 if(parts[0]==="products"&&parts.length===2){
  const product=await db.product.findUnique({where:{id:parts[1]},include:{store:{select:{id:true,name:true,vendor:{select:{displayName:true,user:{select:{email:true}}}}}},category:true,brand:true,variants:{include:{inventory:true}},inventory:true,reviews:{take:10,orderBy:{createdAt:"desc"},include:{user:true}}}});
  if(!product)notFound();
  const [editCategoryRows,editBrands]=await Promise.all([db.category.findMany({where:{isActive:true},select:{id:true,name:true},orderBy:{name:"asc"}}),db.brand.findMany({select:{id:true,name:true},orderBy:{name:"asc"}})]);const editCategories=categoriesWithOtherLast(editCategoryRows as {id:string;name:string}[]);
  const regularStock=product.inventory.find((item:any)=>item.variantId===null);
  return shell(<><Header title={product.name} detail={`${product.store.name} · ${product.store.vendor.displayName} · ${product.store.vendor.user.email}`}/><section className={`${card} mb-5`}><div className="grid gap-3 text-sm sm:grid-cols-2"><p>SKU: {product.sku||"—"}</p><p>Kateqoriya: {product.category?.name||"—"}</p><p>Brend: {product.brand?.name||"—"}</p><p>Qiymət: {Number(product.price).toFixed(2)} ₼ · Endirim: {product.discountPrice?Number(product.discountPrice).toFixed(2):"—"}</p><p>Stok: {product.inventory.reduce((n:number,i:any)=>n+i.quantity,0)}</p><p>Yaradılıb: {product.createdAt.toLocaleString("az-AZ")}</p></div>{product.status!=="ARCHIVED"&&<StatusForm resource="products" id={product.id} status={product.status} options={productStatuses} button="Statusu yenilə" confirm="Məhsul statusunu dəyişmək istəyirsiniz?"/>}</section><AdminProductEditForm productId={product.id} initial={{name:product.name,description:product.description,sku:product.sku,categoryId:product.categoryId,brandId:product.brandId,price:product.price.toString(),discountPrice:product.discountPrice?.toString()??null,images:product.images,quantity:regularStock?.quantity??0,lowStockThreshold:regularStock?.lowStockThreshold??5,variants:product.variants.map((variant:any)=>({id:variant.id,name:variant.name,sku:variant.sku,price:variant.price?.toString()??null,discountPrice:variant.discountPrice?.toString()??null,isActive:variant.isActive,quantity:variant.inventory.find((item:any)=>item.variantId===variant.id)?.quantity??0,lowStockThreshold:variant.inventory.find((item:any)=>item.variantId===variant.id)?.lowStockThreshold??5,reserved:variant.inventory.find((item:any)=>item.variantId===variant.id)?.reserved??0}))}} categories={editCategories} brands={editBrands}/>{product.images.length>0&&<div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{product.images.map((img:string)=><img key={img} src={img} alt="" className="aspect-square w-full rounded-xl object-cover"/>)}</div>}<Table rows={product.variants} columns={[{label:"Variant",cell:r=>r.name},{label:"SKU",cell:r=>r.sku||"—"},{label:"Stok",cell:r=>r.inventory.reduce((n:number,i:any)=>n+i.quantity,0)}]} empty="Variant yoxdur."/><h2 className="mb-3 mt-6 font-semibold">Son rəylər</h2><Table rows={product.reviews} columns={[{label:"Alıcı",cell:r=>r.user.email},{label:"Qiymət",cell:r=>`${r.rating}/5`},{label:"Rəy",cell:r=>r.comment||"—"},{label:"Tarix",cell:r=>r.createdAt.toLocaleDateString("az-AZ")}]} empty="Rəy yoxdur."/></>);
 }

 if(route==="categories"){
  const where:any=q?{name:{contains:q,mode:"insensitive"}}:{};const [rows,total]=await Promise.all([db.category.findMany({where,include:{_count:{select:{products:true,children:true}},parent:{select:{name:true}}},orderBy:{name:"asc"},skip,take}),db.category.count({where})]);return shell(<><Header title="Kateqoriyalar"/><section className={`${card} mb-5`}><h2 className="mb-3 font-semibold">Kateqoriya əlavə et</h2><AdminMutationForm resource="categories" fields={[{name:"name",label:"Ad",required:true},{name:"slug",label:"Slug (istəyə görə)"}]}/></section><Filters path="/admin/categories" q={q}/><Table rows={rows} columns={[{label:"Kateqoriya",cell:r=>r.name},{label:"Slug",cell:r=>r.slug},{label:"Redaktə",cell:r=><AdminMutationForm resource="categories" method="PATCH" className="min-w-52" fields={[{name:"id",label:"",type:"hidden",value:r.id},{name:"name",label:"Ad",value:r.name,required:true},{name:"slug",label:"Slug",value:r.slug,required:true}]}/>},{label:"Ana kateqoriya",cell:r=>r.parent?.name||"—"},{label:"Məhsullar / alt kateqoriyalar",cell:r=>`${r._count.products} / ${r._count.children}`},{label:"Status / silmə",cell:r=><div><span>{r.isActive?"Aktiv":"Deaktiv"}</span><AdminMutationForm resource="categories" method="PATCH" className="mt-2" fields={[{name:"id",label:"",type:"hidden",value:r.id},{name:"isActive",label:r.isActive?"Deaktiv et":"Aktiv et",type:"checkbox",value:!r.isActive}]}/><AdminMutationForm resource="categories" method="DELETE" className="mt-2" fields={[{name:"id",label:"",type:"hidden",value:r.id}]} button="Sil" confirmMessage="Yalnız məhsulu və alt kateqoriyası olmayan kateqoriya silinə bilər. Davam edilsin?"/></div>} ]}/><Pager path="/admin/categories" page={page} total={total} query={pageQuery}/></>);
 }

 if(route==="orders"){
  const from=sp.from&&Number.isFinite(Date.parse(sp.from))?new Date(sp.from):undefined;const to=sp.to&&Number.isFinite(Date.parse(sp.to))?new Date(sp.to):undefined;if(to)to.setDate(to.getDate()+1);const stores=await db.store.findMany({orderBy:{name:"asc"},select:{id:true,name:true}});const where:any={...adminOrderStatusWhere(sp.status,orderStatuses),...(sp.storeId?{storeOrders:{some:{storeId:sp.storeId}}}:{}),...((from||to)?{createdAt:{...(from?{gte:from}:{}),...(to?{lt:to}:{})}}:{}),...(q?{OR:[{id:{contains:q,mode:"insensitive"}},{user:{email:{contains:q,mode:"insensitive"}}},{storeOrders:{some:{store:{name:{contains:q,mode:"insensitive"}}}}}]}:{})};const [rows,total]=await Promise.all([db.order.findMany({where,include:{user:{select:{id:true,email:true}},storeOrders:{include:{store:{select:{name:true}}}}},orderBy:{createdAt:"desc"},skip,take}),db.order.count({where})]);return shell(<><Header title="Sifarişlər" detail="Ümumi sifariş və mağaza sifarişlərini birlikdə idarə edin."/><Filters path="/admin/orders" q={q}><FilterSelect name="status" label="Status" values={[{id:ADMIN_PENDING_ORDER_GROUP,name:"Gözləyən (bütün açıq statuslar)"},...orderStatuses.map(s=>({id:s,name:s}))]} selected={sp.status}/><FilterSelect name="storeId" label="Mağaza" values={stores} selected={sp.storeId}/><label className="grid gap-1 text-xs text-slate-500">Başlanğıc<input type="date" name="from" defaultValue={sp.from||""} className="rounded-lg border px-3 py-2.5 text-sm"/></label><label className="grid gap-1 text-xs text-slate-500">Son tarix<input type="date" name="to" defaultValue={sp.to||""} className="rounded-lg border px-3 py-2.5 text-sm"/></label></Filters><Table rows={rows} columns={[{label:"Sifariş",cell:r=><Link href={`/admin/orders/${r.id}`} className="font-semibold text-[#173c40]">#{r.id.slice(-8).toUpperCase()}</Link>},{label:"Müştəri",cell:r=><Link href={`/admin/customers/${r.user.id}`} className="text-[#173c40]">{r.user.email}</Link>},{label:"Mağazalar",cell:r=>r.storeOrders.map((s:any)=>s.store.name).join(", ")},{label:"Status",cell:r=>r.status},{label:"Cəmi",cell:r=>`${Number(r.total).toFixed(2)} ₼`},{label:"Tarix",cell:r=>r.createdAt.toLocaleDateString("az-AZ")} ]}/><Pager path="/admin/orders" page={page} total={total} query={pageQuery}/></>);
 }
 if (parts[0] === "orders" && parts.length === 2) {
  const order = await db.order.findUnique({
   where: { id: parts[1] },
   include: {
    user: { include: { customerProfile: true } },
    storeOrders: {
     include: {
      store: { select: { id: true, name: true, vendor: { select: { displayName: true, user: { select: { email: true } } } } } },
      items: { include: { variant: true, product: { select: { name: true } } } },
     },
    },
    payments: true,
    delivery: true,
   },
  });
  if (!order) notFound();
  const allowedOrderStatuses = allowedAdminOrderTransitions(order.storeOrders.map((group: any) => group.status));
  return shell(<>
   <Header title={`Sifariş · ${order.id.slice(-8).toUpperCase()}`} detail={`Yaradılıb ${order.createdAt.toLocaleString("az-AZ")} · Ümumi status ${order.status}`} />
   <div className="grid gap-5 xl:grid-cols-2">
    <section className={card}>
     <h2 className="font-semibold">Müştəri</h2>
     <p className="mt-3 text-sm">{order.user.customerProfile?.firstName || ""} {order.user.customerProfile?.lastName || ""} · {order.user.email}</p>
     <pre className="mt-3 whitespace-pre-wrap text-xs text-slate-500">Çatdırılma ünvanı: {JSON.stringify(order.addressSnapshot, null, 2)}</pre>
     <h3 className="mt-5 font-semibold">Ödəniş</h3>
     {order.payments.length
      ? order.payments.map((payment: any) => <p key={payment.id} className="mt-2 text-sm">{payment.status} · {Number(payment.amount).toFixed(2)} {payment.currency} · {payment.provider || "Provayder təyin edilməyib"}{payment.providerReference && !String(payment.providerReference).startsWith("claim:") ? ` · ${payment.providerReference}` : ""}</p>)
      : <p className="mt-2 text-sm text-slate-500">Ödəniş qeydi yoxdur.</p>}
    </section>
    <section className={card}>
     <h2 className="font-semibold">Cəmlər və çatdırılma</h2>
     <p className="mt-3 text-sm">Ara cəm: {Number(order.subtotal).toFixed(2)} ₼</p>
     <p className="mt-1 text-sm">Çatdırılma haqqı: {Number(order.deliveryFee).toFixed(2)} ₼</p>
     <p className="mt-1 text-sm font-semibold">Cəmi: {Number(order.total).toFixed(2)} ₼</p>
     <p className="mt-4 text-sm">Çatdırılma: {order.delivery ? `${order.delivery.status} · ${order.delivery.carrier || "Daşıyıcı təyin edilməyib"} · ${order.delivery.trackingCode || "İzləmə kodu yoxdur"}` : "Çatdırılma qeydi yoxdur"}</p>
    </section>
   </div>
   <div className="mt-5"><StatusForm resource="orders" id={order.id} status={order.status} options={allowedOrderStatuses} button="Statusu saxla" /></div>
   <div className="mt-5 grid gap-4">
    {order.storeOrders.map((group: any) => <section key={group.id} className={card}>
     <h2 className="font-semibold">{group.store.name} · {group.status} · {Number(group.subtotal).toFixed(2)} ₼</h2>
     <p className="mt-2 text-sm text-slate-600">
      Çatdırılma: {group.deliveryMethod || "Mağaza ilə dəqiqləşdirilir"}
      {group.deliveryCarrier ? ` · ${group.deliveryCarrier}` : ""}
      {group.deliveryTrackingCode ? ` · İzləmə: ${group.deliveryTrackingCode}` : ""}
     </p>
     {group.deliveryNote && <p className="mt-1 text-sm text-slate-500">{group.deliveryNote}</p>}
     <p className="mt-1 text-xs text-slate-500">Satıcı: {group.store.vendor.displayName} · {group.store.vendor.user.email}</p>
     <div className="mt-3 divide-y">
      {group.items.map((item: any) => <div key={item.id} className="flex flex-wrap justify-between gap-3 py-3 text-sm">
       <span>{item.productName}{item.variant ? ` · ${item.variant.name}` : ""} × {item.quantity} {item.sku ? `· SKU ${item.sku}` : ""}</span>
       <span>{Number(item.unitPrice).toFixed(2)} × {item.quantity} = {Number(item.lineTotal).toFixed(2)} ₼</span>
      </div>)}
     </div>
    </section>)}
   </div>
  </>);
 }

 if(route==="subscriptions"){
  const statuses=["PENDING","ACTIVE","PAST_DUE","SUSPENDED","CANCELLED","EXPIRED"] as const;const status=normalizeAdminEnumFilter(sp.status,statuses);const where:any=status?{OR:[{subscription:{is:{status}}},...(status==="PENDING"?[{subscription:{is:null}}]:[])]}:{};
  const [stores,total,plans]=await Promise.all([
   db.store.findMany({where,select:{id:true,name:true,status:true,isActive:true,legalInfoApproved:true,vendor:{select:{displayName:true,user:{select:{email:true}}}},subscription:{select:{id:true,planId:true,status:true,currentPeriodStart:true,currentPeriodEnd:true,accessSource:true,grantReason:true,plan:{select:{name:true,monthlyPrice:true}},grantedByAdmin:{select:{email:true}}}},complimentaryEntitlements:complimentaryHistorySelect},orderBy:{createdAt:"desc"},skip,take}),
   db.store.count({where}),
   db.subscriptionPlan.findMany({where:{isActive:true,slug:{in:["basic","pro","professional"]}},orderBy:{monthlyPrice:"asc"},select:{id:true,slug:true,name:true,monthlyPrice:true}}),
  ]);
  const subscriptionIds=stores.flatMap((store:any)=>store.subscription?[store.subscription.id]:[]);
  const history=subscriptionIds.length?await db.auditLog.findMany({where:{entityType:"StoreSubscription",entityId:{in:subscriptionIds}},include:{actor:{select:{email:true}}},orderBy:{createdAt:"desc"},take:100}):[];
  const historyById=new Map<string,any[]>();for(const row of history){const items=historyById.get(row.entityId!)||[];items.push(row);historyById.set(row.entityId!,items)}
  return shell(<><Header title="Abunəliklər" detail="Bütün mağazalar, o cümlədən abunəliyi olmayan satıcılar. Əl ilə giriş ödəniş təsdiqi sayılmır."/><Filters path="/admin/subscriptions" q={q}><FilterSelect name="status" label="Abunəlik statusu" values={statuses.map(s=>({id:s,name:s}))} selected={sp.status}/></Filters><div className="grid gap-4">{stores.map((store:any)=><article key={store.id} className={card}><div className="flex flex-wrap items-start justify-between gap-3"><div><Link href={`/admin/stores/${store.id}`} className="text-lg font-semibold text-[#173c40]">{store.name}</Link><p className="mt-1 text-sm text-slate-600">{store.vendor.displayName} · {store.vendor.user.email}</p><p className="mt-1 text-xs text-slate-500">Mağaza: {store.status} · {store.isActive?"Aktiv":"Deaktiv"} · Hüquqi yoxlama: {store.legalInfoApproved?"təsdiqlənib":"gözləyir"}</p></div><AdminStoreActivationAction storeId={store.id} status={store.status} isActive={store.isActive} legalInfoApproved={store.legalInfoApproved}/></div><div className="mt-3 border-t pt-3 text-sm"><p>Abunəlik: <b>{store.subscription?.plan.name||"yoxdur"}</b> · {store.subscription?.status||"qeydiyyatı yoxdur"} · mənbə: {store.subscription?.accessSource==="PAYMENT_CONFIRMED"?"ödəniş təsdiqi":store.subscription?.accessSource==="ADMIN_MANUAL"?"admin əl ilə":store.subscription?"köhnə/qeyri-müəyyən qeyd":"—"}</p><p className="mt-1 text-xs text-slate-500">Dövr: {store.subscription?.currentPeriodStart?.toLocaleDateString("az-AZ")||"—"} – {store.subscription?.currentPeriodEnd?.toLocaleDateString("az-AZ")||"—"}{store.subscription?.grantedByAdmin?.email?` · Admin: ${store.subscription.grantedByAdmin.email}`:""}</p></div><AdminSubscriptionManager storeId={store.id} plans={plans.map((plan:any)=>({...plan,monthlyPrice:Number(plan.monthlyPrice)}))} subscription={store.subscription?{id:store.subscription.id,planId:store.subscription.planId,status:store.subscription.status,currentPeriodStart:store.subscription.currentPeriodStart,currentPeriodEnd:store.subscription.currentPeriodEnd,accessSource:store.subscription.accessSource,grantReason:store.subscription.grantReason,grantedByAdmin:store.subscription.grantedByAdmin,plan:{name:store.subscription.plan.name,monthlyPrice:Number(store.subscription.plan.monthlyPrice)}}:null}/><AdminComplimentaryManager storeId={store.id} grants={(store.complimentaryEntitlements||[]).map(complimentaryGrantView)}/>{store.subscription&&<details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Dəyişikliklərin audit tarixçəsi ({historyById.get(store.subscription.id)?.length||0})</summary><div className="mt-2 divide-y rounded-lg border px-3">{(historyById.get(store.subscription.id)||[]).map((row:any)=><div key={row.id} className="py-2 text-xs"><b>{row.action}</b> · {row.actor?.email||"Admin hesabı silinib"} · {row.createdAt.toLocaleString("az-AZ")}<p className="mt-1 text-slate-600">Səbəb: {row.metadata?.reason||"—"}</p></div>)}</div></details>}</article>)}</div><Pager path="/admin/subscriptions" page={page} total={total} query={pageQuery}/></>);
 }
 if(route==="commissions"){
  const [rows, total, stores, defaultCommission] = await Promise.all([
   db.commission.findMany({ include: { store: { select: { id: true, name: true } } }, orderBy: { startsAt: "desc" }, skip, take }),
   db.commission.count(),
   db.store.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
   loadSettingSummary(prisma, SETTING_KEYS.commissionDefaultRate),
  ]);
  const storeOptions = stores.map((store: any) => ({ value: store.id, label: store.name }));
  const createFields: AdminField[] = [
   { name: "storeId", label: "Mağaza", type: "select", options: storeOptions, required: true },
   { name: "ratePercent", label: "Komissiya faizi (%)", type: "number", min: "0", max: "100", step: "0.01", placeholder: "məsələn 10", required: true },
   { name: "startsAt", label: "Başlanğıc tarixi", type: "date", value: new Date().toISOString().slice(0, 10), required: true },
   { name: "endsAt", label: "Son tarix", type: "date" },
  ];
  return shell(<>
   <Header title="Komissiyalar" detail="Komissiya faizi və tətbiq müddəti sxemdəki real məlumatlardır." />
   <section className={`${card} mb-5 flex flex-wrap items-center justify-between gap-3`} aria-label="Standart komissiya">
    <div className="min-w-0">
     <p className="text-sm font-semibold text-[#0d1b2a]">Standart komissiya: {defaultCommission.display}</p>
     <p className="mt-1 text-sm text-slate-600">{defaultCommission.isSet ? "Öz qaydası olmayan mağazaların yeni sifarişlərinə tətbiq olunur. Aşağıdakı mağaza qaydaları üstündür." : "Öz qaydası olmayan mağazaların sifarişlərində komissiya qeydə alınmır. Aşağıdakı mağaza qaydaları üstündür."}</p>
    </div>
    <Link href="/admin/settings?tab=finance" className="rounded-xl border border-[#ded9cf] px-4 py-2.5 text-sm font-semibold text-[#173c40]">Maliyyə parametrlərinə keç</Link>
   </section>
   <section className={card}>
    <h2 className="mb-3 font-semibold">Komissiya əlavə et</h2>
    <AdminMutationForm resource="commissions" fields={createFields} button="Yarat" />
   </section>
   <div className="mt-5">
    <Table rows={rows} columns={[
     { label: "Mağaza", cell: (row) => <Link className="text-[#173c40]" href={`/admin/stores/${row.store.id}`}>{row.store.name}</Link> },
     { label: "Faiz", cell: (row) => `${(Number(row.rate) * 100).toFixed(2)}%` },
     { label: "Başlanğıc", cell: (row) => row.startsAt.toLocaleDateString("az-AZ") },
     { label: "Son", cell: (row) => row.endsAt?.toLocaleDateString("az-AZ") || "Davam edir" },
     {
      label: "Dəyişiklik",
      cell: (row) => <AdminMutationForm
       resource="commissions"
       method="PATCH"
       className="min-w-64"
       button="Yadda saxla"
       fields={[
        { name: "id", label: "", type: "hidden", value: row.id },
        { name: "storeId", label: "Mağaza", type: "select", value: row.storeId, options: storeOptions, required: true },
        { name: "ratePercent", label: "Faiz (%)", type: "number", value: commissionRateToPercent(row.rate), min: "0", max: "100", step: "0.01", required: true },
        { name: "startsAt", label: "Başlanğıc", type: "date", value: row.startsAt.toISOString().slice(0, 10), required: true },
        { name: "endsAt", label: "Son", type: "date", value: row.endsAt?.toISOString().slice(0, 10) || "" },
       ]}
      />,
     },
    ]} />
   </div>
   <Pager path="/admin/commissions" page={page} total={total} query={pageQuery} />
  </>);
 }

 if(route==="returns"){
  const [rows,total]=await Promise.all([db.returnRequest.findMany({include:{store:{select:{id:true,name:true}},storeOrder:{select:{orderId:true}},orderItem:{select:{productName:true,variantName:true,quantity:true,lineTotal:true}},customer:{select:{email:true}}},orderBy:{createdAt:"desc"},skip,take}),db.returnRequest.count()]);
  const returnLabels:Record<string,string>={REQUESTED:"Sorğu göndərildi",APPROVED:"Təsdiqləndi",REJECTED:"Rədd edildi",ITEM_RECEIVED:"Məhsul qəbul edildi",REFUND_PENDING:"Geri ödəniş gözləyir",REFUNDED:"Geri ödənildi",EXCHANGE_PENDING:"Dəyişdirilmə hazırlanır",EXCHANGED:"Dəyişdirildi",CANCELLED:"Ləğv edildi"};
  return shell(<><Header title="Qaytarılma sorğuları" detail="Admin qərarları audit jurnalında saxlanılır. Geri ödəniş statusu provayder təsdiqi olmadan tamamlanmır."/><Table rows={rows} columns={[{label:"Sorğu",cell:r=><span>{r.orderItem.productName}{r.orderItem.variantName?` · ${r.orderItem.variantName}`:""}<small className="block text-slate-500">Sifariş #{r.storeOrder.orderId.slice(-8).toUpperCase()} · {r.orderItem.quantity} ədəd</small></span>},{label:"Müştəri",cell:r=>r.customer.email},{label:"Mağaza",cell:r=><Link href={`/admin/stores/${r.store.id}`} className="text-[#173c40]">{r.store.name}</Link>},{label:"Məbləğ",cell:r=>`${Number(r.refundAmount).toFixed(2)} ₼`},{label:"Status",cell:r=>returnLabels[r.status]||r.status},{label:"Admin qərarı",cell:r=>r.status==="REQUESTED"?<AdminMutationForm resource="returns" method="PATCH" className="min-w-64" button="Qərarı saxla" fields={[{name:"id",label:"",type:"hidden",value:r.id},{name:"action",label:"Qərar",type:"select",required:true,options:[{value:"approve",label:"Təsdiqlə"},{value:"reject",label:"Rədd et"}]},{name:"note",label:"Daxili admin qeydi",type:"textarea",required:true}]}/>:r.adminNote||"—"} ]}/><Pager path="/admin/returns" page={page} total={total} query={pageQuery}/></>);
 }

 if(route==="support"){
  const statuses=["OPEN","IN_PROGRESS","RESOLVED","CLOSED"] as const;const status=normalizeAdminEnumFilter(sp.status,statuses);const where:any={...(status?{status}:{}),...(q?{OR:[{subject:{contains:q,mode:"insensitive"}},{user:{email:{contains:q,mode:"insensitive"}}}]}:{})};const [rows,total]=await Promise.all([db.supportTicket.findMany({where,include:{user:{select:{email:true,role:true}}},orderBy:{createdAt:"desc"},skip,take}),db.supportTicket.count({where})]);return shell(<><Header title="Dəstək müraciətləri" detail="Mövcud sxemdə prioritet sahəsi yoxdur."/><Filters path="/admin/support" q={q}><FilterSelect name="status" label="Status" values={statuses.map(s=>({id:s,name:s}))} selected={sp.status}/></Filters><Table rows={rows} columns={[{label:"Müraciət",cell:r=><Link href={`/admin/support/${r.id}`} className="font-semibold text-[#173c40]">{r.subject}</Link>},{label:"Müraciətçi",cell:r=>`${r.user.email} · ${r.user.role}`},{label:"Status",cell:r=><StatusForm resource="support" id={r.id} status={r.status} options={statuses} button="Yenilə"/>},{label:"Tarix",cell:r=>r.createdAt.toLocaleDateString("az-AZ")} ]}/><Pager path="/admin/support" page={page} total={total} query={pageQuery}/></>);
 }
 if(parts[0]==="support"&&parts.length===2){const ticket=await db.supportTicket.findUnique({where:{id:parts[1]},include:{user:{select:{id:true,email:true,role:true}}}});if(!ticket)notFound();return shell(<><Header title={ticket.subject} detail={`${ticket.user.email} · ${ticket.user.role} · ${ticket.createdAt.toLocaleString("az-AZ")}`}/><section className={card}><p className="whitespace-pre-wrap text-sm leading-6">{ticket.message}</p><div className="mt-5 border-t pt-4"><StatusForm resource="support" id={ticket.id} status={ticket.status} options={["OPEN","IN_PROGRESS","RESOLVED","CLOSED"]} button="Statusu yenilə"/></div></section></>)}

 if(route==="imports"){
  const where:any=q?{sourceName:{contains:q,mode:"insensitive"}}:{};
  const [rows,total]=await Promise.all([
   db.productImport.findMany({where,orderBy:{createdAt:"desc"},skip,take}),
   db.productImport.count({where}),
  ]);
  const storeIds=[...new Set(rows.map((row:any)=>row.storeId))];
  const stores=await db.store.findMany({where:{id:{in:storeIds}},select:{id:true,name:true}});
  const storeNames=new Map<string,string>(stores.map((store:any)=>[store.id,store.name] as [string,string]));
  return shell(<><Header title="İdxal tarixçəsi" detail="CSV/XLSX fayllar əvvəlcə yoxlanılır; yalnız seçilmiş mağazaya aid məhsullar yazılır."/><AdminProductImport/><Filters path="/admin/imports" q={q}/><Table rows={rows} columns={[{label:"Fayl",cell:r=>r.sourceName},{label:"Mağaza",cell:r=>{const name=storeNames.get(r.storeId);return name?<Link href={`/admin/stores/${r.storeId}`} className="text-[#173c40]">{name}</Link>:"Mağaza tapılmadı"}},{label:"Status",cell:r=>r.status},{label:"Yaradılıb",cell:r=>r.createdAt.toLocaleString("az-AZ")},{label:"Nəticə",cell:r=><pre className="max-w-xs whitespace-pre-wrap text-xs">{JSON.stringify(r.result||{})}</pre>} ]}/><Pager path="/admin/imports" page={page} total={total} query={pageQuery}/></>);
 }
 if(route==="reports"){
  const defaultFrom=new Date(new Date().getFullYear(),new Date().getMonth(),1);
  const fromRange=sp.from?parseLocalDateRange(sp.from):null;
  const toRange=sp.to?parseLocalDateRange(sp.to):null;
  const from=fromRange?.start??defaultFrom;
  const to=toRange?.end??new Date();
  const dateValid=(!sp.from||fromRange!==null)&&(!sp.to||toRange!==null)&&Number.isFinite(from.valueOf())&&Number.isFinite(to.valueOf())&&from<=to;
  const rangeTooLong=dateValid&&to.getTime()-from.getTime()>366*24*60*60*1000;
  const range=dateValid&&!rangeTooLong?{gte:from,lte:to}:{gte:defaultFrom,lte:new Date()};
  const where:any={status:"DELIVERED",OR:[{deliveredAt:range},{deliveredAt:null,createdAt:range}],...(sp.storeId?{storeId:sp.storeId}:{}),...(sp.cityId?{store:{cityId:sp.cityId}}:{})};
  const [stores,cities]=await Promise.all([
   db.store.findMany({orderBy:{name:"asc"},select:{id:true,name:true}}),
   db.city.findMany({orderBy:{name:"asc"},select:{id:true,name:true}}),
  ]);
  const orders=rangeTooLong?[]:await db.storeOrder.findMany({where,include:{store:{select:{id:true,name:true}},items:true,returnRequests:{where:{status:"REFUNDED"},select:{orderItemId:true,status:true,refundAmount:true}}},orderBy:{createdAt:"asc"}});
  const monthlySales=summarizeMonthlyStoreSales(orders);
  const sales=summarizeDeliveredSales(orders);
  const storeNames=new Map<string,string>(stores.map((store:any)=>[store.id,store.name] as [string,string]));
  const money=(cents:number)=>(cents/100).toFixed(2);
  return shell(<>
   <Header title="Hesabatlar" detail="Satış məbləğləri təsdiqlənmiş geri ödənişlər çıxıldıqdan sonra göstərilir."/>
   <form action="/admin/reports" className="mb-5 flex flex-wrap items-end gap-3 rounded-2xl border bg-white p-4">
    <label className="grid gap-1 text-xs text-slate-500">Başlanğıc<input name="from" type="date" defaultValue={dateValid?formatLocalDateInput(from):formatLocalDateInput(defaultFrom)} className="rounded-lg border px-3 py-2"/></label>
    <label className="grid gap-1 text-xs text-slate-500">Son tarix<input name="to" type="date" defaultValue={dateValid?formatLocalDateInput(to):formatLocalDateInput(new Date())} className="rounded-lg border px-3 py-2"/></label>
    <FilterSelect name="storeId" label="Mağaza" values={stores} selected={sp.storeId}/>
    <FilterSelect name="cityId" label="Şəhər" values={cities} selected={sp.cityId}/>
    <button className="rounded-lg bg-[#173c40] px-4 py-2.5 text-sm text-white">Tətbiq et</button>
   </form>
   {rangeTooLong&&<p className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">Hesabat ən çox 366 günlük aralıq üçün hesablanır. CSV ixracı da eyni limiti tətbiq edir.</p>}
   {!rangeTooLong&&<a href={`/api/admin/reports?${new URLSearchParams({from:formatLocalDateInput(dateValid?from:defaultFrom),to:formatLocalDateInput(dateValid?to:new Date()),...(sp.storeId?{storeId:sp.storeId}:{}),...(sp.cityId?{cityId:sp.cityId}:{})})}`} className="mb-5 inline-flex rounded-lg border border-[#173c40] px-4 py-2.5 text-sm font-semibold text-[#173c40]">CSV hesabatını yüklə</a>}
   {!rangeTooLong&&<div className="mb-5 grid gap-3 sm:grid-cols-3">
    <div className={card}><span className="text-sm text-slate-500">Xalis satış sifarişləri</span><b className="mt-2 block text-2xl">{sales.orders}</b></div>
    <div className={card}><span className="text-sm text-slate-500">Çatdırılmış məhsul miqdarı</span><b className="mt-2 block text-2xl">{sales.quantity}</b></div>
    <div className={card}><span className="text-sm text-slate-500">Satış (refund çıxılmaqla)</span><b className="mt-2 block text-2xl">{money(sales.revenueCents)} ₼</b></div>
   </div>}
   {!rangeTooLong&&<><p className="mb-5 text-xs text-slate-500">Məhsul miqdarı çatdırılmış vahidlərdir; refund məbləği xalis satışdan çıxılır. Qismən refund üzrə qaytarılmış vahid sayı ayrıca saxlanmadığından miqdar yenidən hesablanmır.</p>
   <h2 className="mb-3 font-semibold">Tarixə görə</h2>
   <Table rows={sales.daily} columns={[{label:"Tarix",cell:r=>r.id},{label:"Xalis satış sifarişləri",cell:r=>r.count},{label:"Çatdırılmış miqdar",cell:r=>r.quantity},{label:"Satış (xalis)",cell:r=>`${money(r.revenueCents)} ₼`}]}/>
   <h2 className="mb-3 mt-6 font-semibold">Aylıq mağaza satışı və komissiya</h2>
   <p className="mb-3 text-sm text-slate-500">Komissiya sifariş yaradılarkən qeydə alınmış faiz snapshot-ı ilə çatdırılmış sifarişin xalis məhsul məbləğindən hesablanır; təsdiqlənmiş qaytarmalar satış bazasından çıxılır. Snapshot yoxdursa komissiya məbləği hesablanmır. Bu hesabat ödəniş və ya mağaza ilə hesablaşma əməliyyatı yaratmır.</p>
   <Table rows={monthlySales.map((row:any)=>({id:`${row.storeId}:${row.month}`,...row,storeName:storeNames.get(row.storeId)||row.storeId}))} columns={[{label:"Ay",cell:r=>r.month},{label:"Mağaza",cell:r=><Link href={`/admin/stores/${r.storeId}`} className="text-[#173c40]">{r.storeName}</Link>},{label:"Sifarişlər",cell:r=>r.orders},{label:"Satış (xalis)",cell:r=>`${money(r.salesCents)} ₼`},{label:"Komissiya faizi",cell:r=>r.ordersWithoutRule?`Qayda yoxdur (${r.ordersWithoutRule})`:r.rate===null?"Dəyişən":`${(r.rate*100).toFixed(2)}%`},{label:"Komissiya",cell:r=>r.commissionCents===null?"Tam hesablana bilmir":`${money(r.commissionCents)} ₼`}]}/>
   <h2 className="mb-3 mt-6 font-semibold">Mağazaya görə (xalis)</h2>
   <Table rows={sales.byStore.map((row:any)=>({...row,name:storeNames.get(row.id)||row.id}))} columns={[{label:"Mağaza",cell:r=><Link href={`/admin/stores/${r.id}`} className="text-[#173c40]">{r.name}</Link>},{label:"Xalis sifarişlər",cell:r=>r.count},{label:"Çatdırılmış miqdar",cell:r=>r.quantity},{label:"Satış (xalis)",cell:r=>`${money(r.revenueCents)} ₼`}]}/>
   <h2 className="mb-3 mt-6 font-semibold">Məhsula görə (xalis)</h2>
   <Table rows={sales.byProduct} columns={[{label:"Məhsul",cell:r=>r.id},{label:"Sətir",cell:r=>r.count},{label:"Çatdırılmış miqdar",cell:r=>r.quantity},{label:"Satış (xalis)",cell:r=>`${money(r.revenueCents)} ₼`}]}/>
   </>}
  </>);
 }
 notFound();
}
