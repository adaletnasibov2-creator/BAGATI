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
