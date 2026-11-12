import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireStoreAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolvePublicStoreEligibility } from "@/lib/store-eligibility";
import { sellerLegalRequirements, sellerRequirementLabels } from "@/lib/seller-legal-policy";
import { categoriesWithOtherLast } from "@/lib/category-order";
import { allowedVendorOrderTransitions } from "@/lib/order-status";
import { OrderFulfillmentError, transitionVendorStoreOrder } from "@/lib/order-fulfillment";
import { isOwnedStoreAssetUrl } from "@/lib/storage/store-assets";
import { deliveryAmountSchema } from "@/lib/delivery";
import { allowedShipmentTransitions, SHIPMENT_STATUSES, type ShipmentStatusValue } from "@/lib/shipment-tracking";
import { hasOverlappingEnabledPromotion } from "@/lib/promotion-pricing";
import { countProductsWithLowStock } from "@/lib/vendor-inventory";
import { activeComplimentaryEntitlementSelect, assertFeature, assertProductLimit, complimentaryFromRows, EntitlementError, entitlementErrorResponse, getStoreEntitlements } from "@/lib/subscription-entitlements";
import { enqueueEmail } from "@/lib/email-outbox";
import { checkImportRows, ImportInventoryReservationError, isSafeImportImageUrl, parseImportVariants } from "@/lib/product-import";
import { CatalogSkuConflictError, findExistingProductSkuMatches, findExistingVariantSkuKeys, isSkuUniqueViolation } from "@/lib/catalog-import-persistence";
import { hasDuplicateNormalizedSkus } from "@/lib/sku-normalization";
import { legacyVendorProductPatchSchema, legacyVendorProductSchema } from "@/lib/vendor-product-schemas";
import { assertUniqueVariantCombinations } from "@/lib/product-variants";
import { parseImportByExtension, ImportParseError } from "@/lib/import-parsers";
import { isStorefrontTheme } from "@/lib/storefront-themes";
import { getStorefrontBrandingCompatibility } from "@/lib/storefront-branding-compat";
import { contactPhoneIssue, optionalAzPhoneSchema } from "@/lib/az-phone";
import { checkStoreSubmission } from "@/lib/store-submission";
import { checkVendorProductActivation, isVendorProductActivation } from "@/lib/vendor-product-publication";
import { optionalStockQuantitySchema, requiredStockQuantitySchema } from "@/lib/stock-quantity";
import { generateProductCode } from "@/lib/product-code";
import { vendorNotificationHref, vendorNotificationScope } from "@/lib/vendor-notifications";
import { summarizeVendorFinance } from "@/lib/vendor-finance";
import { summarizePaymentStatus, vendorOrderWhere } from "@/lib/vendor-order-search";

const statuses = ["NEW", "CONFIRMED", "PREPARING", "READY", "HANDED_TO_COURIER", "DELIVERED", "CANCELLED", "RETURNED"] as const;
const db: any = prisma;
const slugify=(s:string)=>s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"")||"mehsul";
async function scope(storeId:string){const access=await requireStoreAccess(storeId);return access?.user.role==="VENDOR"?access:null}
export async function GET(req:NextRequest,{params}:{params:Promise<{storeId:string;section:string}>}){
 const {storeId,section}=await params; const access=await scope(storeId); if(!access)return NextResponse.json({error:"Mağazaya giriş icazəsi yoxdur"},{status:403});
 const from=req.nextUrl.searchParams.get("from"),to=req.nextUrl.searchParams.get("to");
 if(section==="imports"){
  const entitlement=await getStoreEntitlements(storeId,db);
  try{assertFeature(entitlement,"BULK_IMPORT");}
  catch(error){if(error instanceof EntitlementError)return entitlementErrorResponse(error);throw error;}
  const items=await db.productImport.findMany({where:{storeId},select:{id:true,sourceName:true,status:true,createdAt:true,result:true},orderBy:{createdAt:"desc"},take:20});
  return NextResponse.json({items});
 }
 if(section==="orders"){
  const requestedPage=Number(req.nextUrl.searchParams.get("page")||"1"),requestedPageSize=Number(req.nextUrl.searchParams.get("pageSize")||"20");
  const requestedPageNumber=Number.isSafeInteger(requestedPage)&&requestedPage>0?requestedPage:1,pageSize=Number.isSafeInteger(requestedPageSize)&&requestedPageSize>0?Math.min(requestedPageSize,100):20;
  const status=req.nextUrl.searchParams.get("status");
  if(status&&!statuses.includes(status as typeof statuses[number])&&!new Set(["PENDING","PROCESSING","SHIPPED"]).has(status))return NextResponse.json({error:"Sifariş statusu düzgün deyil"},{status:400});
  // storeId is always applied; the search only narrows within this store's orders.
  const where=vendorOrderWhere(storeId,status,req.nextUrl.searchParams.get("q"));
  const total=await db.storeOrder.count({where}),totalPages=Math.ceil(total/pageSize),page=totalPages?Math.min(requestedPageNumber,totalPages):1;
  const rows=await db.storeOrder.findMany({where,include:{items:{select:{id:true,productName:true,quantity:true,variant:{select:{name:true,options:true}}}},order:{select:{id:true,createdAt:true,payments:{select:{status:true}}}}},orderBy:{createdAt:"desc"},skip:(page-1)*pageSize,take:pageSize});
  const items=rows.map((row:any)=>{const {payments,...order}=row.order;return {...row,order,payment:summarizePaymentStatus(payments.map((p:any)=>p.status))};});
  return NextResponse.json({items,page,pageSize,total,totalPages});
 }
 if(section==="products"){const [items,categories,brands]=await Promise.all([db.product.findMany({where:{storeId},include:{category:true,brand:true,variants:{include:{inventory:true}},inventory:true},orderBy:{updatedAt:"desc"}}),db.category.findMany({where:{isActive:true},select:{id:true,name:true},orderBy:{name:"asc"}}),db.brand.findMany({select:{id:true,name:true},orderBy:{name:"asc"}})]);return NextResponse.json({items,categories:categoriesWithOtherLast(categories),brands});}
  if(section==="inventory")return NextResponse.json({items:await db.inventory.findMany({where:{product:{storeId}},include:{product:{select:{name:true,sku:true}},variant:{select:{id:true,name:true,sku:true,options:true,isActive:true}},adjustments:{orderBy:{createdAt:"desc"},take:5}},orderBy:{updatedAt:"desc"}})});
 if(section==="campaigns"){
  const q=req.nextUrl.searchParams.get("q")?.trim()||"";
  const [items,products]=await Promise.all([
   db.promotion.findMany({where:{storeId},include:{products:{include:{product:{select:{id:true,name:true,sku:true,status:true,price:true}}}}},orderBy:{startsAt:"desc"}}),
   db.product.findMany({where:{storeId,status:"ACTIVE",...(q?{OR:[{name:{contains:q,mode:"insensitive"}},{sku:{contains:q,mode:"insensitive"}}]}:{})},select:{id:true,name:true,sku:true,price:true},orderBy:{name:"asc"},take:30}),
  ]);
  return NextResponse.json({items,products});
 }
 if(section==="profile"){
  const [store,branding,cities]=await Promise.all([
   db.store.findUnique({
    where:{id:storeId},
    select:{
     id:true,name:true,slug:true,description:true,logoUrl:true,cityId:true,address:true,latitude:true,longitude:true,mapUrl:true,
     contactPhone:true,contactEmail:true,freeDeliveryThreshold:true,deliveryFee:true,status:true,isActive:true,
     legalInfoApproved:true,reviewNote:true,
     city:{select:{id:true,name:true}},
     subscription:{select:{status:true,plan:{select:{name:true,monthlyPrice:true}}}},
     vendor:{select:{displayName:true,phone:true,sellerType:true,legalName:true,voen:true,legalAddress:true,user:{select:{email:true,isActive:true}}}},
    },
   }),
   getStorefrontBrandingCompatibility(storeId),
   db.city.findMany({where:{isActive:true},select:{id:true,name:true},orderBy:{name:"asc"}}),
  ]);
  return NextResponse.json({
   store:store?{...store,bannerUrl:branding?.bannerUrl??null,theme:branding?.theme??"forest",storefrontBrandingAvailable:branding?.available??false}:null,
   cities,
   legalRequirementsByType:{INDIVIDUAL_ENTREPRENEUR:sellerLegalRequirements("INDIVIDUAL_ENTREPRENEUR"),REGISTERED_COMPANY:sellerLegalRequirements("REGISTERED_COMPANY")},
  });
 }
 if(section==="reviews"){
  const ratingParam=Number(req.nextUrl.searchParams.get("rating")||"0");
  const rating=Number.isInteger(ratingParam)&&ratingParam>=1&&ratingParam<=5?ratingParam:null;
  const [rows,aggregate,distribution]=await Promise.all([
   // Only the reviewer's first name and last initial are exposed to the seller.
   db.review.findMany({where:{product:{storeId},...(rating?{rating}:{})},select:{id:true,rating:true,comment:true,createdAt:true,product:{select:{id:true,name:true}},user:{select:{customerProfile:{select:{firstName:true,lastName:true}}}}},orderBy:{createdAt:"desc"},take:100}),
   db.review.aggregate({where:{product:{storeId}},_avg:{rating:true},_count:{_all:true}}),
   db.review.groupBy({by:["rating"],where:{product:{storeId}},_count:{_all:true}}),
  ]);
  const items=rows.map((row:any)=>({id:row.id,rating:row.rating,comment:row.comment,createdAt:row.createdAt,product:row.product,author:[row.user.customerProfile?.firstName,row.user.customerProfile?.lastName?`${row.user.customerProfile.lastName.slice(0,1)}.`:null].filter(Boolean).join(" ")||"Alıcı"}));
  return NextResponse.json({items,summary:{average:aggregate._avg.rating,total:aggregate._count._all,distribution:Object.fromEntries(distribution.map((row:any)=>[row.rating,row._count._all]))}});
 }
 if(section==="notifications"){
  const filter=req.nextUrl.searchParams.get("filter");
  const [rows,unread]=await Promise.all([
   db.notification.findMany({where:vendorNotificationScope(access.user.id,storeId,{unreadOnly:filter==="unread"}),select:{id:true,title:true,body:true,readAt:true,createdAt:true,storeId:true},orderBy:{createdAt:"desc"},take:100}),
   db.notification.count({where:vendorNotificationScope(access.user.id,storeId,{unreadOnly:true})}),
  ]);
  return NextResponse.json({items:rows.map((row:any)=>({id:row.id,title:row.title,body:row.body,readAt:row.readAt,createdAt:row.createdAt,href:vendorNotificationHref(storeId,row.title,row.storeId===storeId)})),unread});
 }
 if(section==="sales"){
  const start=from?new Date(from):new Date(new Date().getFullYear(),new Date().getMonth(),1),end=to?new Date(to+"T23:59:59.999"):new Date();
  if(isNaN(start.valueOf())||isNaN(end.valueOf())||start>end)return NextResponse.json({error:"Tarix aralığı yanlışdır"},{status:400});
  const period={gte:start,lte:end};const orders=await db.storeOrder.findMany({where:{storeId,status:"DELIVERED",OR:[{deliveredAt:period},{deliveredAt:null,createdAt:period}]},include:{items:{include:{product:{select:{category:{select:{id:true,name:true}}}}}}},orderBy:{createdAt:"asc"}});
  const daily=new Map<string,{orders:number;quantity:number;revenue:number}>(),byProduct=new Map<string,{quantity:number;revenue:number}>(),byCategory=new Map<string,{name:string;quantity:number;revenue:number}>();let revenue=0,quantity=0;
  for(const order of orders){const day=(order.deliveredAt||order.createdAt).toISOString().slice(0,10),row=daily.get(day)||{orders:0,quantity:0,revenue:0};row.orders++;row.revenue+=Number(order.subtotal);daily.set(day,row);revenue+=Number(order.subtotal);for(const item of order.items){quantity+=item.quantity;row.quantity+=item.quantity;const product=byProduct.get(item.productName)||{quantity:0,revenue:0};product.quantity+=item.quantity;product.revenue+=Number(item.lineTotal);byProduct.set(item.productName,product);const category=item.product.category,name=category?.name||"Kateqoriyasız",key=category?.id||"uncategorized",categoryRow=byCategory.get(key)||{name,quantity:0,revenue:0};categoryRow.quantity+=item.quantity;categoryRow.revenue+=Number(item.lineTotal);byCategory.set(key,categoryRow)}}
  const monthly=new Map<string,{orders:number;quantity:number;revenue:number}>();for(const [date,row] of daily){const month=date.slice(0,7),m=monthly.get(month)||{orders:0,quantity:0,revenue:0};m.orders+=row.orders;m.quantity+=row.quantity;m.revenue+=row.revenue;monthly.set(month,m)}
  const entitlement=await getStoreEntitlements(storeId,db);let advancedAnalytics=null;
  try{assertFeature(entitlement,"ADVANCED_ANALYTICS");
   const duration=end.getTime()-start.getTime()+1,previousStart=new Date(start.getTime()-duration),previousEnd=new Date(start.getTime()-1);
   const [previousOrders,lowStockProducts]=await Promise.all([
    db.storeOrder.findMany({where:{storeId,status:"DELIVERED",OR:[{deliveredAt:{gte:previousStart,lte:previousEnd}},{deliveredAt:null,createdAt:{gte:previousStart,lte:previousEnd}}]},select:{subtotal:true}}),
    db.product.findMany({where:{storeId,status:"ACTIVE"},select:{id:true,inventory:{where:{variantId:null},select:{quantity:true,reserved:true,lowStockThreshold:true}},variants:{where:{isActive:true},select:{inventory:{select:{quantity:true,reserved:true,lowStockThreshold:true}}}}}}),
   ]);
   const previousRevenue=previousOrders.reduce((sum:number,order:any)=>sum+Number(order.subtotal),0),previousCount=previousOrders.length;
   const lowStock=countProductsWithLowStock(lowStockProducts);
   advancedAnalytics={averageOrderValue:orders.length?revenue/orders.length:0,previousPeriod:{orders:previousCount,revenue:previousRevenue},topProducts:[...byProduct].map(([name,value])=>({name,...value})).sort((a,b)=>b.revenue-a.revenue).slice(0,10),topCategories:[...byCategory.values()].sort((a,b)=>b.revenue-a.revenue).slice(0,10),lowStockProducts:lowStock};}catch(error){if(!(error instanceof EntitlementError))throw error}
  // Finance: delivered orders in the selected period plus all currently open orders (their payment state is "now", not historical).
  const financeSelect={id:true,status:true,subtotal:true,deliveryFee:true,commissionRateSnapshot:true,createdAt:true,deliveredAt:true,order:{select:{payments:{select:{status:true}}}},items:{select:{quantity:true}},returnRequests:{select:{status:true,refundAmount:true}}};
  const [financeDelivered,financeOpen]=await Promise.all([
   db.storeOrder.findMany({where:{storeId,status:"DELIVERED",OR:[{deliveredAt:period},{deliveredAt:null,createdAt:period}]},select:financeSelect}),
   db.storeOrder.findMany({where:{storeId,status:{notIn:["DELIVERED","CANCELLED","RETURNED"]}},select:financeSelect}),
  ]);
  const finance=summarizeVendorFinance([...financeDelivered,...financeOpen].map((row:any)=>({id:row.id,status:row.status,subtotal:row.subtotal,deliveryFee:row.deliveryFee,commissionRateSnapshot:row.commissionRateSnapshot,createdAt:row.createdAt,deliveredAt:row.deliveredAt,paymentStatuses:row.order.payments.map((p:any)=>p.status),itemQuantity:row.items.reduce((n:number,i:any)=>n+i.quantity,0),returnRequests:row.returnRequests})));
  const currentCommission=await db.commission.findFirst({where:{storeId,startsAt:{lte:new Date()},OR:[{endsAt:null},{endsAt:{gt:new Date()}}]},orderBy:{startsAt:"desc"},select:{rate:true}});
  return NextResponse.json({finance,currentCommissionRate:currentCommission?Number(currentCommission.rate):null,payoutsTracked:false,period:{from:start.toISOString(),to:end.toISOString()},orders:orders.length,quantity,revenue,daily:[...daily].map(([date,value])=>({date,...value})),monthly:[...monthly].map(([month,value])=>({month,...value})),products:[...byProduct].map(([name,value])=>({name,...value})),advancedAnalytics});
 }
 if(section==="settings")return NextResponse.json({store:await db.store.findUnique({where:{id:storeId},select:{id:true,name:true,isActive:true,createdAt:true,updatedAt:true}}),commission:await db.commission.findFirst({where:{storeId,OR:[{endsAt:null},{endsAt:{gt:new Date()}}]},orderBy:{startsAt:"desc"}})});
 if(section==="subscription"){
  const [subscription,plans,products,variants,entitlement]=await Promise.all([
   db.storeSubscription.findUnique({where:{storeId},include:{plan:true}}),
   db.subscriptionPlan.findMany({where:{isActive:true},orderBy:{monthlyPrice:"asc"}}),
   db.product.count({where:{storeId,status:"ACTIVE"}}),
   db.productVariant.count({where:{isActive:true,product:{storeId}}}),
   getStoreEntitlements(storeId,db),
  ]);
  return NextResponse.json({subscription,plans,usage:{products,variants},entitlement:{eligible:entitlement.eligible,plan:entitlement.plan,limits:entitlement.limits}});
 }
  return NextResponse.json({error:"Bu əməliyyat dəstəklənmir"},{status:405});
}
export async function POST(req:NextRequest,{params}:{params:Promise<{storeId:string;section:string}>}){
  const {storeId,section}=await params; const access=await scope(storeId); if(!access)return NextResponse.json({error:"Mağazaya giriş icazəsi yoxdur"},{status:403});
  let body:any; try{body=await req.json()}catch{return NextResponse.json({error:"Sorğu məlumatı yanlışdır"},{status:400})}
  if(section==="products"){
   const parsed=legacyVendorProductSchema.safeParse(body); if(!parsed.success)return NextResponse.json({error:"Məhsul məlumatları yanlışdır"},{status:422});
   const d=parsed.data;
   const entitlement=await getStoreEntitlements(storeId,db);
    const publish=parsed.data.status==="ACTIVE";if(publish){if(!entitlement.eligible||!entitlement.plan)return entitlementErrorResponse(new EntitlementError("SUBSCRIPTION_REQUIRED",null));try{await assertProductLimit(db,storeId,entitlement.plan);}catch(error){if(error instanceof EntitlementError)return entitlementErrorResponse(error);throw error}}
   if(hasDuplicateNormalizedSkus(parsed.data.variants.map((variant:any)=>variant.sku)))return NextResponse.json({error:"Seçimlərin məhsul kodları təkrarlana bilməz"},{status:409});
   try{assertUniqueVariantCombinations(parsed.data.variants);}catch{return NextResponse.json({error:"Eyni variant kombinasiyası təkrarlanıb"},{status:422});}
   const ownedImages=parsed.data.images.filter((url:string)=>isOwnedStoreAssetUrl(storeId,url));
   try {
   const product=await db.$transaction(async(tx:any)=>{
    if (d.status === "ACTIVE" && !(await resolvePublicStoreEligibility([storeId], tx)).has(storeId)) return null;
    if(parsed.data.sku&&(await findExistingProductSkuMatches(tx,storeId,[parsed.data.sku])).length)throw new CatalogSkuConflictError("PRODUCT");
    const variantSkus=parsed.data.variants.flatMap((variant:any)=>variant.sku?[variant.sku]:[]);
    if(variantSkus.length){const existing=await findExistingVariantSkuKeys(tx,variantSkus);if(variantSkus.some((sku:string)=>existing.has(sku)))throw new CatalogSkuConflictError("VARIANT");}
    const productId=crypto.randomUUID();
    const created=await tx.product.create({data:{id:productId,storeId,name:parsed.data.name,slug:`${slugify(parsed.data.name)}-${productId.slice(0,8)}`,description:parsed.data.description??null,price:new Prisma.Decimal(parsed.data.price),discountPrice:parsed.data.discountPrice?new Prisma.Decimal(parsed.data.discountPrice):null,sku:parsed.data.sku||generateProductCode(productId),categoryId:parsed.data.categoryId??null,brandId:parsed.data.brandId??null,images:ownedImages,status:parsed.data.status}});
    const inv=await tx.inventory.create({data:{productId:created.id,quantity:parsed.data.quantity}});
    if(parsed.data.quantity>0)await tx.inventoryAdjustment.create({data:{inventoryId:inv.id,actorUserId:access.user.id,delta:parsed.data.quantity,previousQuantity:0,newQuantity:parsed.data.quantity,reason:"İlkin stok"}});
    for(const variant of parsed.data.variants){const v=await tx.productVariant.create({data:{productId:created.id,name:variant.name,options:variant.options as Prisma.InputJsonValue,sku:variant.sku??null}});await tx.inventory.create({data:{productId:created.id,variantId:v.id,quantity:variant.quantity}});if(variant.quantity>0)await tx.inventoryAdjustment.create({data:{inventoryId:(await tx.inventory.findFirst({where:{productId:created.id,variantId:v.id}})).id,actorUserId:access.user.id,delta:variant.quantity,previousQuantity:0,newQuantity:variant.quantity,reason:"İlkin variant stoku"}});}
    return created;
   });
   if(!product)return NextResponse.json({error:"Mağaza satışa hazır deyil; məhsulu yayımlamaq mümkün olmadı",code:"STORE_NOT_ELIGIBLE"},{status:409});
   return NextResponse.json(product,{status:201});
   } catch(error) {
    if(error instanceof CatalogSkuConflictError || isSkuUniqueViolation(error)) {
     return NextResponse.json({error:"Məhsul və ya seçim kodu artıq istifadə olunur"},{status:409});
    }
    throw error;
   }
  }
  if(section==="campaigns"){
   const s=z.object({name:z.string().trim().min(2).max(160),discountType:z.enum(["PERCENT","FIXED"]),discountValue:z.coerce.number().positive(),startsAt:z.string(),endsAt:z.string(),productIds:z.array(z.string()).max(200).default([])}).safeParse(body);
   if(!s.success)return NextResponse.json({error:"Kampaniya məlumatları yanlışdır"},{status:422});
   const start=new Date(s.data.startsAt),end=new Date(s.data.endsAt);
   if(isNaN(start.valueOf())||isNaN(end.valueOf())||start>=end)return NextResponse.json({error:"Kampaniya tarixi yanlışdır"},{status:422});
   if(s.data.productIds.length){const owned=await db.product.count({where:{id:{in:s.data.productIds},storeId}});if(owned!==s.data.productIds.length)return NextResponse.json({error:"Yalnız öz məhsullarınızı seçin"},{status:403});}
    const existingPromotions=await db.promotion.findMany({where:{storeId,isActive:true},select:{startsAt:true,endsAt:true}});if(hasOverlappingEnabledPromotion(start,end,existingPromotions))return NextResponse.json({error:"Eyni dövrdə başqa kampaniya aktivdir"},{status:409});
   const promotion=await db.promotion.create({data:{storeId,name:s.data.name,discountType:s.data.discountType,discountValue:new Prisma.Decimal(s.data.discountValue),startsAt:start,endsAt:end,products:{create:s.data.productIds.map(id=>({productId:id}))}}});
   return NextResponse.json(promotion,{status:201});
  }

  if(section==="submit"){
   const store=await db.store.findUnique({where:{id:storeId},select:{id:true,status:true,isActive:true,legalInfoApproved:true,subscription:{select:{id:true,status:true}},adminManaged:true,vendor:{select:{sellerType:true,legalName:true,legalAddress:true,voen:true}}}});
   if(!store)return NextResponse.json({error:"Mağaza tapılmadı"},{status:404});
   const submission=checkStoreSubmission({
    status:store.status,
    legalInfoApproved:store.legalInfoApproved,
    adminManaged:store.adminManaged,
    hasSubscription:Boolean(store.subscription),
    sellerType:store.vendor.sellerType,
    legalName:store.vendor.legalName,
    voen:store.vendor.voen,
    legalAddress:store.vendor.legalAddress,
   });
   if(!submission.ok){
    if(submission.reason==="LEGAL_INFORMATION_INCOMPLETE")return NextResponse.json({
     error:`Yoxlamaya göndərməzdən əvvəl hüquqi məlumatları tamamlayın: ${submission.missingFields.map((field)=>sellerRequirementLabels[field]).join(", ")}.`,
     missingFields:submission.missingFields,
    },{status:422});
    if(submission.reason==="SUBSCRIPTION_REQUIRED")return NextResponse.json({error:"Satış yoxlamasına göndərmək üçün abunəlik planı seçin",code:"SUBSCRIPTION_REQUIRED"},{status:409});
    return NextResponse.json({error:"Bu statusda mağazanı yoxlamaya göndərmək mümkün deyil."},{status:409});
   }
   const updated=await db.store.update({where:{id:storeId},data:{status:"PENDING_REVIEW",isActive:store.isActive??false},select:{id:true,status:true,isActive:true}});
   return NextResponse.json(updated);
  }
  if(section==="subscription"){
   const s=z.object({planId:z.string().min(1)}).safeParse(body);if(!s.success)return NextResponse.json({error:"Plan seçimi yanlışdır"},{status:422});
   const plan=await db.subscriptionPlan.findFirst({where:{id:s.data.planId,isActive:true},select:{id:true}});if(!plan)return NextResponse.json({error:"Plan tapılmadı və ya aktiv deyil"},{status:404});
   const changed=await db.$transaction(async(tx:any)=>{const existing=await tx.storeSubscription.findUnique({where:{storeId},select:{id:true,status:true}});if(existing){if(existing.status!=="PENDING")return false;const result=await tx.storeSubscription.updateMany({where:{id:existing.id,status:"PENDING"},data:{planId:plan.id}});return result.count===1;}await tx.storeSubscription.create({data:{storeId,planId:plan.id,status:"PENDING"}});return true;}).catch((error:unknown)=>{if(error&&typeof error==="object"&&"code" in error&&error.code==="P2002")return false;throw error;});if(!changed)return NextResponse.json({error:"Mövcud abunəliyi bu səhifədən dəyişmək mümkün deyil. Ödəniş və aktivləşdirmə üçün dəstəyə müraciət edin."},{status:409});
   return NextResponse.json({subscription:await db.storeSubscription.findUnique({where:{storeId},include:{plan:true}}),message:"Plan seçimi yeniləndi. Ödəniş edilməyib; abunəlik gözləyir statusundadır."});
  }
  if(section==="imports"){

   const entitlement=await getStoreEntitlements(storeId,db);
    try{assertFeature(entitlement,"BULK_IMPORT");}
    catch(error){if(error instanceof EntitlementError)return entitlementErrorResponse(error);throw error;}
   const parsed=z.object({action:z.enum(["validate","import"]),mode:z.enum(["create","update","mixed"]).default("create"),sourceName:z.string().trim().min(1).max(255),mapping:z.record(z.string()),rows:z.array(z.record(z.unknown())).min(1).max(1000),fileText:z.string().max(5_000_000).optional()}).safeParse(body);
   if(!parsed.success)return NextResponse.json({error:"Fayl, sütun uyğunlaşdırması və sətirləri yoxlayın"},{status:422});
   const {action,mode,sourceName,mapping,rows}=parsed.data;
   let effectiveRows:Record<string,unknown>[]=rows;let effectiveMapping=mapping;let sourceFormat:string|undefined;
   if(typeof parsed.data.fileText==="string"&&parsed.data.fileText.length){
    try{const {format,parsed:fileParsed}=parseImportByExtension(sourceName,parsed.data.fileText);effectiveRows=fileParsed.rows;effectiveMapping={...Object.fromEntries(fileParsed.headers.map(header=>[header,header])),...mapping};sourceFormat=format;}
    catch(error){return NextResponse.json({error:error instanceof ImportParseError?error.message:"Fayl oxunmadı"},{status:422})}
   }
   if(!effectiveMapping.name||!effectiveMapping.price||!effectiveMapping.category)return NextResponse.json({error:"Məhsul adı, qiymət və kateqoriya sütunlarını uyğunlaşdırın"},{status:422});
    const [categoryRows,brands,existing]=await Promise.all([db.category.findMany({where:{isActive:true},select:{id:true,name:true,slug:true}}),db.brand.findMany({select:{id:true,name:true}}),db.product.findMany({where:{storeId},select:{id:true,sku:true,inventory:{where:{variantId:null},select:{quantity:true,reserved:true},take:1}}})]);
   const categories=categoriesWithOtherLast(categoryRows as {id:string;name:string;slug:string}[]);
    const variantSkuValues=effectiveMapping.variants?effectiveRows.flatMap((row)=>parseImportVariants(String(row[effectiveMapping.variants]??"")).variants.flatMap((variant)=>variant.sku?[variant.sku]:[])):[];
    const existingVariantSkuKeys=await findExistingVariantSkuKeys(db,variantSkuValues);
    const checked=checkImportRows({rows:effectiveRows,mapping:effectiveMapping,mode,categories,brands,existing:existing.map((product:any)=>({...product,inventory:product.inventory[0]??null})),existingVariantSkuKeys,isImageUrlAllowed:(url)=>isSafeImportImageUrl(url)&&isOwnedStoreAssetUrl(storeId,url)});
   const validRows=checked.filter((row:any)=>row.status!=="INVALID");
   if(action==="validate")return NextResponse.json({rows:checked,validCount:validRows.length,invalidCount:checked.length-validRows.length,warningCount:checked.filter((row:any)=>row.status==="WARNING").length,mode});
   if(!validRows.length)return NextResponse.json({error:"İdxal üçün uyğun sətir yoxdur",rows:checked,created:0,successCount:0,errorCount:checked.length},{status:422});
   const activeCount=await db.product.count({where:{storeId,status:"ACTIVE"}});
   const newCreates=validRows.filter((row:any)=>row.action==="create").length;
    const activeLimit=entitlement.limits?.activeProducts??0;if(!activeLimit)return NextResponse.json({error:"Mağaza satışa hazır deyil; idxal üçün aktiv paket tələb olunur",code:"SUBSCRIPTION_REQUIRED"},{status:409});if(activeCount+newCreates>activeLimit){
      return NextResponse.json({error:"Paket məhsul limitinə çatdınız. Daha çox məhsul üçün paketi yüksəltin.",code:"PRODUCT_LIMIT_REACHED",current:activeCount,incoming:newCreates,limit:activeLimit},{status:409});
   }
     const record=await db.productImport.create({data:{storeId,sourceName,status:"VALIDATING",columnMapping:{...effectiveMapping,mode,format:sourceFormat??"xlsx"}}});
   try{
    const result=await db.$transaction(async(tx:any)=>{
     let created=0,updated=0;
      const updateProductIds=[...new Set(validRows.filter((row:any)=>row.action==="update"&&row.existingId).map((row:any)=>row.existingId as string))];
      if(updateProductIds.length){
       const currentInventory=await tx.inventory.findMany({where:{productId:{in:updateProductIds},variantId:null},select:{id:true,productId:true}});
       for(const inventory of currentInventory.sort((a:any,b:any)=>a.id.localeCompare(b.id))){await tx.$queryRaw`SELECT "id" FROM "Inventory" WHERE "id" = ${inventory.id} FOR UPDATE`;}
      }
      const lockedInventory=updateProductIds.length?await tx.inventory.findMany({where:{productId:{in:updateProductIds},variantId:null},select:{id:true,productId:true,quantity:true,reserved:true,lowStockThreshold:true}}):[];
      const inventoryByProduct=new Map<string,any>(lockedInventory.map((inventory:any)=>[inventory.productId,inventory]));
      for(const row of validRows){if(row.action==="update"&&row.existingId){const inv=inventoryByProduct.get(row.existingId);if(inv&&typeof row.product.quantity==="number"&&row.product.quantity<inv.reserved)throw new ImportInventoryReservationError();}}
     for(const row of validRows){const value=row.product;
      if(row.action==="update"&&row.existingId){
       await tx.product.updateMany({where:{id:row.existingId,storeId},data:{name:value.name,description:value.description,price:new Prisma.Decimal(value.price),discountPrice:value.discountPrice===null?null:new Prisma.Decimal(value.discountPrice),categoryId:value.categoryId,brandId:value.brandId,...(value.images.length?{images:value.images}:{})}});
        const inv=inventoryByProduct.get(row.existingId);
       if(inv&&typeof value.quantity==="number"){const delta=value.quantity-inv.quantity;if(delta!==0){await tx.inventory.update({where:{id:inv.id},data:{quantity:value.quantity,lowStockThreshold:value.lowStockThreshold}});await tx.inventoryAdjustment.create({data:{inventoryId:inv.id,actorUserId:access.user.id,delta,previousQuantity:inv.quantity,newQuantity:value.quantity,reason:"Toplu idxalla stok yeniləndi"}});}}
       updated++;
      } else {
       if(value.sku&&(await findExistingProductSkuMatches(tx,storeId,[value.sku])).length)throw new CatalogSkuConflictError("PRODUCT");
       const variantSkus=value.variants.flatMap((variant:any)=>variant.sku?[variant.sku]:[]);
       if(variantSkus.length){const existing=await findExistingVariantSkuKeys(tx,variantSkus);if(variantSkus.some((sku:string)=>existing.has(sku)))throw new CatalogSkuConflictError("VARIANT");}
       const productId=crypto.randomUUID();
       const product=await tx.product.create({data:{id:productId,storeId,name:value.name,slug:`${slugify(value.name)}-${productId.slice(0,8)}`,description:value.description,price:new Prisma.Decimal(value.price),discountPrice:value.discountPrice===null?null:new Prisma.Decimal(value.discountPrice),sku:value.sku||generateProductCode(productId),categoryId:value.categoryId,brandId:value.brandId,images:value.images,status:"DRAFT"}});
       const createdQuantity=value.quantity??0;
       const inv=await tx.inventory.create({data:{productId:product.id,quantity:createdQuantity,lowStockThreshold:value.lowStockThreshold}});
       if(createdQuantity>0)await tx.inventoryAdjustment.create({data:{inventoryId:inv.id,actorUserId:access.user.id,delta:createdQuantity,previousQuantity:0,newQuantity:createdQuantity,reason:"Toplu idxalla ilkin stok yaradıldı"}});
       if(value.variants.length)for(const variant of value.variants){const v=await tx.productVariant.create({data:{productId:product.id,name:variant.name,options:variant.options as Prisma.InputJsonValue,sku:variant.sku||null,price:variant.price==null?null:new Prisma.Decimal(variant.price),discountPrice:variant.discountPrice==null?null:new Prisma.Decimal(variant.discountPrice),images:variant.images??[]}});await tx.inventory.create({data:{productId:product.id,variantId:v.id,quantity:variant.quantity??0,lowStockThreshold:variant.lowStockThreshold??5}});}
       created++;
      }
     }
     const errors=checked.filter((row:any)=>row.status==="INVALID").map((row:any)=>({index:row.index,errors:row.errors,sku:row.product.sku,name:row.product.name}));
     await tx.productImport.update({where:{id:record.id},data:{status:"COMPLETED",completedAt:new Date(),result:{rowCount:checked.length,successCount:created+updated,created,updated,errorCount:errors.length,errors,mode}}});
     return {created,updated,errors};
    });
    return NextResponse.json({created:result.created,updated:result.updated,successCount:result.created+result.updated,errorCount:result.errors.length,rows:checked,mode},{status:result.errors.length?207:201});
    }catch(error){const reservationConflict=error instanceof ImportInventoryReservationError;const skuConflict=error instanceof CatalogSkuConflictError||isSkuUniqueViolation(error);const summary=reservationConflict?"Yeni stok miqdarı rezerv edilmiş stokdan az ola bilməz":skuConflict?"Məhsul və ya seçim kodu artıq istifadə olunur":"Məhsulları saxlamaq mümkün olmadı";await db.productImport.update({where:{id:record.id},data:{status:"FAILED",completedAt:new Date(),result:{rowCount:checked.length,successCount:0,errorCount:checked.length,errors:[summary],mode}}});return NextResponse.json({error:reservationConflict||skuConflict?summary:"Məhsullar saxlanmadı. İdxal tarixçəsində nəticəni yoxlayın."},{status:reservationConflict||skuConflict?409:500})}
  }
  return NextResponse.json({error:"Bu əməliyyat dəstəklənmir"},{status:405});
}

export async function PATCH(req:NextRequest,{params}:{params:Promise<{storeId:string;section:string}>}){
 const {storeId,section}=await params;const access=await scope(storeId);if(!access)return NextResponse.json({error:"Mağazaya giriş icazəsi yoxdur"},{status:403});let b:any;try{b=await req.json()}catch{return NextResponse.json({error:"Sorğu məlumatı yanlışdır"},{status:400})}
 if(section==="notifications"){
  const s=z.union([z.object({id:z.string().min(1).max(64)}),z.object({all:z.literal(true)})]).safeParse(b);
  if(!s.success)return NextResponse.json({error:"Bildiriş seçimi yanlışdır"},{status:422});
  // Ownership is enforced in the WHERE clause (vendorNotificationScope): another seller's id simply matches nothing → 404.
  const targetId="id" in s.data?s.data.id:undefined;
  const changed=await db.notification.updateMany({where:vendorNotificationScope(access.user.id,storeId,{unreadOnly:true,id:targetId}),data:{readAt:new Date()}});
  if(targetId&&changed.count===0){
   const exists=await db.notification.findFirst({where:vendorNotificationScope(access.user.id,storeId,{id:targetId}),select:{id:true}});
   if(!exists)return NextResponse.json({error:"Bildiriş tapılmadı"},{status:404});
  }
  const unread=await db.notification.count({where:vendorNotificationScope(access.user.id,storeId,{unreadOnly:true})});
  return NextResponse.json({updated:changed.count,unread});
 }
 if(section==="orders"){
  const s=z.object({id:z.string(),status:z.enum(statuses).optional(),shipmentStatus:z.enum(SHIPMENT_STATUSES).optional(),trackingUrl:z.string().trim().url().max(1000).nullable().optional(),deliveryMethod:z.string().trim().max(80).nullable().optional(),deliveryNote:z.string().trim().max(1000).nullable().optional(),deliveryCarrier:z.string().trim().max(80).nullable().optional(),deliveryTrackingCode:z.string().trim().max(120).nullable().optional()}).refine(value=>Boolean(value.status)||Boolean(value.shipmentStatus)||[value.trackingUrl,value.deliveryMethod,value.deliveryNote,value.deliveryCarrier,value.deliveryTrackingCode].some(value=>value!==undefined)).safeParse(b);
  if(!s.success)return NextResponse.json({error:"Status yanlışdır"},{status:422});
  if(s.data.trackingUrl&&!s.data.trackingUrl.startsWith("https://"))return NextResponse.json({error:"İzləmə linki HTTPS olmalıdır"},{status:422});
  try {
   const result=await db.$transaction(async(tx:any)=>{
    const existing=await tx.storeOrder.findFirst({where:{id:s.data.id,storeId}});
    if(!existing)return {error:"NOT_FOUND"};
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${existing.orderId} FOR UPDATE`;
    const locked=await tx.storeOrder.findFirst({where:{id:existing.id,storeId}});
    if(!locked)return {error:"NOT_FOUND"};
    if(s.data.shipmentStatus&&!allowedShipmentTransitions(locked.shipmentStatus as ShipmentStatusValue|null).includes(s.data.shipmentStatus))return {error:"INVALID_SHIPMENT_TRANSITION"};
    const targetOrderStatus=s.data.status||(s.data.shipmentStatus==="DELIVERED"?"DELIVERED":undefined);
    if(targetOrderStatus&&!allowedVendorOrderTransitions(locked.status).includes(targetOrderStatus))return {error:"INVALID_TRANSITION"};
    if(s.data.shipmentStatus==="DELIVERED"&&!(["HANDED_TO_COURIER","SHIPPED"].includes(locked.status)))return {error:"SHIPMENT_ORDER_STATUS_MISMATCH"};
    const deliveryData:any={};for(const key of ["deliveryMethod","deliveryNote","deliveryCarrier","deliveryTrackingCode","trackingUrl"] as const)if(s.data[key]!==undefined)deliveryData[key]=s.data[key];
    if(s.data.shipmentStatus){deliveryData.shipmentStatus=s.data.shipmentStatus;const stampedAt=new Date();if(s.data.shipmentStatus==="SHIPPED")deliveryData.shippedAt=stampedAt;if(s.data.shipmentStatus==="OUT_FOR_DELIVERY")deliveryData.outForDeliveryAt=stampedAt;if(s.data.shipmentStatus==="DELIVERED")deliveryData.deliveredAt=stampedAt;}
    let item;
    let warning: string | undefined;
    if(targetOrderStatus){
     const transitioned=await transitionVendorStoreOrder(tx,{id:locked.id,storeId,actorUserId:access.user.id,targetStatus:targetOrderStatus,extraData:deliveryData});
     item=transitioned.item;warning=transitioned.warning;
    } else if(Object.keys(deliveryData).length){
     const changed=await tx.storeOrder.updateMany({where:{id:locked.id,storeId,status:locked.status,shipmentStatus:locked.shipmentStatus},data:deliveryData});if(changed.count!==1)return {error:"CONFLICT"};
     item=await tx.storeOrder.findUnique({where:{id:locked.id},include:{items:true}});
    } else {
     item=await tx.storeOrder.findUnique({where:{id:locked.id},include:{items:true}});
    }
    const order=await tx.order.findUnique({where:{id:locked.orderId},select:{id:true,user:{select:{email:true}}}});
    const store=await tx.store.findUnique({where:{id:storeId},select:{name:true}});
    if(order&&store){
     if(targetOrderStatus&&targetOrderStatus!==locked.status){
      await enqueueEmail(tx,{eventKey:`order-status:${locked.id}:${targetOrderStatus}`,recipient:order.user.email,template:"ORDER_STATUS",payload:{orderRef:order.id,storeName:store.name,status:targetOrderStatus}});
     }
     const trackingCode=s.data.deliveryTrackingCode??locked.deliveryTrackingCode;
     const trackingUrl=s.data.trackingUrl??locked.trackingUrl;
     const trackingChanged=s.data.shipmentStatus!==undefined||s.data.deliveryTrackingCode!==undefined||s.data.trackingUrl!==undefined||s.data.deliveryCarrier!==undefined;
     if(trackingChanged&&(trackingCode||trackingUrl)){
      await enqueueEmail(tx,{eventKey:`shipment-update:${locked.id}:${s.data.shipmentStatus??"tracking"}:${String(trackingCode??"")}:${String(trackingUrl??"")}`,recipient:order.user.email,template:"SHIPMENT_UPDATE",payload:{orderRef:order.id,storeName:store.name,statusLabel:s.data.shipmentStatus??locked.shipmentStatus??"Yenilənib",carrier:s.data.deliveryCarrier??locked.deliveryCarrier??"",trackingCode:trackingCode??"",trackingUrl:trackingUrl??""}});
     }
    }
    return {item,warning};
   });
   if(result.error==="NOT_FOUND")return NextResponse.json({error:"Sifariş tapılmadı"},{status:404});
   if(result.error==="INVALID_TRANSITION")return NextResponse.json({error:"Bu status keçidi mümkün deyil"},{status:409});
   if(result.error==="INVALID_SHIPMENT_TRANSITION")return NextResponse.json({error:"Bu çatdırılma statusu keçidi mümkün deyil"},{status:409});
   if(result.error==="SHIPMENT_ORDER_STATUS_MISMATCH")return NextResponse.json({error:"Sifariş kuryerə verilmədən çatdırılmış kimi qeyd edilə bilməz"},{status:409});
   if(result.error)return NextResponse.json({error:"Sifariş paralel olaraq yeniləndi"},{status:409});
   return NextResponse.json(result);
  } catch(error) {
   if(error instanceof OrderFulfillmentError){
    const status=error.code==="NOT_FOUND"?404:409;
    const message=error.code==="NOT_FOUND"?"Sifari\u015f tap\u0131lmad\u0131":error.code==="PAYMENT_NOT_SETTLED"?"\u00d6d\u0259ni\u015f t\u0259sdiql\u0259nm\u0259d\u0259n sifari\u015f \u00e7atd\u0131r\u0131lm\u0131\u015f kimi qeyd edil\u0259 bilm\u0259z":error.code==="INVALID_TRANSITION"?"Bu status ke\u00e7idi m\u00fcmk\u00fcn deyil":"Sifari\u015f paralel olaraq yenil\u0259ndi";
    return NextResponse.json({error:message},{status});
   }
   return NextResponse.json({error:"Sifari\u015f yenil\u0259nm\u0259di"},{status:500});
  }
 }
 if(section==="products"){
  const s=legacyVendorProductPatchSchema.safeParse(b);
  if(!s.success)return NextResponse.json({error:"Məhsul məlumatlarını yoxlayın"},{status:422});
  const {id,...v}=s.data;
  if(v.price!==undefined&&v.discountPrice!==undefined&&v.discountPrice!==null&&v.discountPrice>=v.price)return NextResponse.json({error:"Endirimli qiymət əsas qiymətdən az olmalıdır"},{status:422});
  const updateData={...v,...(v.price!==undefined?{price:new Prisma.Decimal(v.price)}:{}),...(v.discountPrice!==undefined?{discountPrice:v.discountPrice===null?null:new Prisma.Decimal(v.discountPrice)}:{})};
  if(v.status==="ACTIVE"){
   try{
    const result=await db.$transaction(async(tx:any)=>{
     await tx.$queryRaw`SELECT "id" FROM "Store" WHERE "id" = ${storeId} FOR UPDATE`;
     await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${id} AND "storeId" = ${storeId} FOR UPDATE`;
     const current=await tx.product.findFirst({where:{id,storeId},include:{category:{select:{isActive:true}},inventory:{select:{variantId:true,quantity:true,reserved:true}},variants:{select:{id:true,name:true,options:true,isActive:true,price:true,discountPrice:true,inventory:{select:{variantId:true,quantity:true,reserved:true}}}}}});
     if(!current)return {error:"NOT_FOUND" as const};
     if(v.sku&&(await findExistingProductSkuMatches(tx,storeId,[v.sku],current.id)).length)throw new CatalogSkuConflictError("PRODUCT");
     if(v.images?.some((url:string)=>!isOwnedStoreAssetUrl(storeId,url)&&!current.images.includes(url)))return {error:"IMAGE_NOT_OWNED" as const};

     if(isVendorProductActivation(current.status,v.status)){
      const store=await tx.store.findUnique({where:{id:storeId},select:{
       status:true,isActive:true,legalInfoApproved:true,adminManaged:true,
       city:{select:{isActive:true}},
       vendor:{select:{sellerType:true,legalName:true,voen:true,legalAddress:true,user:{select:{isActive:true}}}},
       subscription:{select:{status:true,currentPeriodStart:true,currentPeriodEnd:true,plan:{select:{slug:true,isActive:true}}}},
       complimentaryEntitlements:activeComplimentaryEntitlementSelect,
      }});
      if(!store)return {error:"STORE_NOT_ELIGIBLE" as const,blockers:["Mağaza tapılmadı."]};
      const categoryId=v.categoryId!==undefined?v.categoryId:current.categoryId;
      const category=categoryId===current.categoryId
       ?current.category
       :categoryId===null?null:await tx.category.findFirst({where:{id:categoryId,isActive:true},select:{isActive:true}});
      const productCandidate={
       id:current.id,
       name:v.name??current.name,
       description:v.description!==undefined?v.description:current.description,
       price:v.price!==undefined?v.price:current.price,
       discountPrice:v.discountPrice!==undefined?v.discountPrice:current.discountPrice,
       categoryId,
       category,
       inventory:current.inventory,
       variants:current.variants,
      };
      const activeProductCount=await tx.product.count({where:{storeId,status:"ACTIVE"}});
      const check=checkVendorProductActivation({
       store:{
        status:store.status,isActive:store.isActive,legalInfoApproved:store.legalInfoApproved,adminManaged:store.adminManaged,
        vendorActive:store.vendor.user.isActive,cityActive:store.city.isActive,
        sellerType:store.vendor.sellerType,legalName:store.vendor.legalName,voen:store.vendor.voen,legalAddress:store.vendor.legalAddress,
        subscriptionStatus:store.subscription?.status??null,planSlug:store.subscription?.plan.slug??null,planActive:store.subscription?.plan.isActive??false,
        periodStart:store.subscription?.currentPeriodStart??null,periodEnd:store.subscription?.currentPeriodEnd??null,
        complimentary:complimentaryFromRows(store.complimentaryEntitlements),
       },
       product:productCandidate,
       activeProductCount,
      });
      if(!check.ok)return {error:check.reason,check};
     }
     const item=await tx.product.update({where:{id:current.id},data:updateData});
     return {item};
    });
    if("error" in result){
     if(result.error==="NOT_FOUND")return NextResponse.json({error:"Məhsul tapılmadı"},{status:404});
     if(result.error==="IMAGE_NOT_OWNED")return NextResponse.json({error:"Yeni şəkilləri bu mağazanın yükləmə bölməsindən əlavə edin"},{status:422});
     if(result.error==="PRODUCT_LIMIT_REACHED"&&"check" in result&&result.check.reason==="PRODUCT_LIMIT_REACHED"){
      return entitlementErrorResponse(new EntitlementError("PRODUCT_LIMIT_REACHED",result.check.plan,result.check.current,result.check.limit));
     }
     if("check" in result&&result.check.reason==="PRODUCT_NOT_READY")return NextResponse.json({error:"Məhsul yayımlanmağa hazır deyil",blockers:result.check.blockers},{status:422});
     const blockers="check" in result&&result.check.reason==="STORE_NOT_ELIGIBLE"?result.check.blockers:("blockers" in result?result.blockers:[]);
     return NextResponse.json({error:"Mağaza məhsul yayımlamaq üçün uyğun deyil",code:"STORE_NOT_ELIGIBLE",blockers},{status:409});
    }
    return NextResponse.json({item:result.item});
   }catch(error){
    if(error instanceof EntitlementError)return entitlementErrorResponse(error);
    if(error instanceof CatalogSkuConflictError||isSkuUniqueViolation(error))return NextResponse.json({error:"Bu məhsul kodu mağazanızda artıq istifadə olunur"},{status:409});
    return NextResponse.json({error:"Məhsul yenilənmədi"},{status:500});
   }
  }

  const found=await db.product.findFirst({where:{id,storeId}});
  if(!found)return NextResponse.json({error:"Məhsul tapılmadı"},{status:404});
  if(v.images?.some((url)=>!isOwnedStoreAssetUrl(storeId,url)&&!found.images.includes(url)))return NextResponse.json({error:"Yeni şəkilləri bu mağazanın yükləmə bölməsindən əlavə edin"},{status:422});
  if(v.sku&&(await findExistingProductSkuMatches(db,storeId,[v.sku],found.id)).length)return NextResponse.json({error:"Bu məhsul kodu mağazanızda artıq istifadə olunur"},{status:409});
  try{return NextResponse.json({item:await db.product.update({where:{id:found.id},data:updateData})});}
  catch(error){if(isSkuUniqueViolation(error))return NextResponse.json({error:"Bu məhsul kodu mağazanızda artıq istifadə olunur"},{status:409});throw error;}
 }
 if(section==="inventory"){
  const s=z.object({id:z.string(),quantity:requiredStockQuantitySchema,reason:z.string().trim().min(2).max(300),lowStockThreshold:optionalStockQuantitySchema}).safeParse(b);if(!s.success)return NextResponse.json({error:"Stok məlumatlarını yoxlayın"},{status:422});const prior=await db.inventory.findFirst({where:{id:s.data.id,product:{storeId}},select:{id:true}});if(!prior)return NextResponse.json({error:"Stok qeydi tapılmadı"},{status:404});try{const item=await db.$transaction(async(tx:any)=>{await tx.$queryRaw`SELECT "id" FROM "Inventory" WHERE "id" = ${prior.id} FOR UPDATE`;const current=await tx.inventory.findUnique({where:{id:prior.id}});if(!current)throw new Error("INVENTORY_NOT_FOUND");if(s.data.quantity<current.reserved)throw new Error("STOCK_BELOW_RESERVED");const updated=await tx.inventory.update({where:{id:prior.id},data:{quantity:s.data.quantity,...(s.data.lowStockThreshold!==undefined?{lowStockThreshold:s.data.lowStockThreshold}:{})}});if(current.quantity!==s.data.quantity)await tx.inventoryAdjustment.create({data:{inventoryId:prior.id,actorUserId:access.user.id,delta:s.data.quantity-current.quantity,previousQuantity:current.quantity,newQuantity:s.data.quantity,reason:s.data.reason}});return updated});return NextResponse.json({item})}catch(error){if(error instanceof Error&&error.message==="STOCK_BELOW_RESERVED")return NextResponse.json({error:"Yeni stok rezerv edilmiş miqdardan az ola bilməz"},{status:422});return NextResponse.json({error:"Stok yenilənə bilmədi"},{status:500})}
 }
 if(section==="profile"){
   const s=z.object({
     name:z.string().trim().min(2).max(120),
     slug:z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
    description:z.string().trim().max(3000).nullable().optional(),
    logoUrl:z.union([z.string().max(500),z.literal("")]).nullable().optional(),
    bannerUrl:z.union([z.string().max(500),z.literal("")]).nullable().optional(),
    theme:z.custom<import("@/lib/storefront-themes").StorefrontTheme>(isStorefrontTheme).optional(),
    cityId:z.string().min(1),
    address:z.string().trim().max(300).optional().or(z.literal("")),
    latitude:z.number().finite().min(-90).max(90).nullable(),
    longitude:z.number().finite().min(-180).max(180).nullable(),
    mapUrl:z.string().url().max(1000).nullable().optional(),
    contactPhone:optionalAzPhoneSchema.optional(),
    contactEmail:z.string().trim().email().max(254).optional().or(z.literal("")),
    freeDeliveryThreshold:deliveryAmountSchema.optional(),
    deliveryFee:deliveryAmountSchema.optional(),
    sellerType:z.enum(["INDIVIDUAL_ENTREPRENEUR","REGISTERED_COMPANY"]).nullable().optional().or(z.literal("")),
    legalName:z.string().trim().max(200).nullable().optional(),
    voen:z.string().trim().max(32).nullable().optional(),
    legalAddress:z.string().trim().max(400).nullable().optional(),
   }).safeParse(b);
   if(!s.success)return NextResponse.json({error:contactPhoneIssue(s.error)??"Mağaza və hüquqi məlumatları yoxlayın"},{status:422});
   const d=s.data;
   if((d.latitude===null)!==(d.longitude===null))return NextResponse.json({error:"Koordinatlar birlikdə daxil edilməlidir"},{status:422});
   if(d.mapUrl&&!/^https:\/\//i.test(d.mapUrl))return NextResponse.json({error:"Xəritə linki HTTPS olmalıdır"},{status:422});
   if(d.logoUrl&&!isOwnedStoreAssetUrl(storeId,d.logoUrl))return NextResponse.json({error:"Yalnız bu mağaza üçün yüklənmiş loqodan istifadə edin"},{status:422});
   if(d.bannerUrl&&!isOwnedStoreAssetUrl(storeId,d.bannerUrl))return NextResponse.json({error:"Yalnız bu mağaza üçün yüklənmiş örtük şəklindən istifadə edin"},{status:422});
   const city=await db.city.findFirst({where:{id:d.cityId,isActive:true},select:{id:true}});
   if(!city)return NextResponse.json({error:"Aktiv şəhər seçin"},{status:422});
   const owned=await db.store.findFirst({
    where:{id:storeId,vendor:{userId:access.user.id}},
    select:{
      id:true,status:true,vendorId:true,name:true,slug:true,description:true,logoUrl:true,
     vendor:{select:{sellerType:true,legalName:true,voen:true,legalAddress:true}},
    },
   });
   if(!owned)return NextResponse.json({error:"Mağaza tapılmadı"},{status:404});
    const branding=await getStorefrontBrandingCompatibility(owned.id);
    if(d.slug!==undefined&&d.slug!==owned.slug){
     const slugInUse=await db.store.findFirst({where:{slug:d.slug,id:{not:owned.id}},select:{id:true}});
     if(slugInUse)return NextResponse.json({error:"Mağaza ünvanı artıq istifadə olunur. Başqa ünvan seçin."},{status:409});
    }
   if(!branding)return NextResponse.json({error:"Mağaza tapılmadı"},{status:404});
   if(!branding.available&&(d.bannerUrl!==undefined||d.theme!==undefined)){
    return NextResponse.json({error:"Mağaza örtüyü və rəng mövzusu bazada hələ saxlanıla bilmir. Admin mağaza görünüşü miqrasiyasını ayrıca tətbiq etdikdən sonra yenidən cəhd edin.",code:"STOREFRONT_BRANDING_MIGRATION_REQUIRED"},{status:409});
   }
   const {logoUrl,bannerUrl,theme,sellerType,legalName,voen,legalAddress,...values}=d;
   const legalPatch={
    ...(sellerType!==undefined?{sellerType:sellerType||null}:{}),
    ...(legalName!==undefined?{legalName:legalName||null}:{}),
    ...(voen!==undefined?{voen:voen||null}:{}),
    ...(legalAddress!==undefined?{legalAddress:legalAddress||null}:{}),
   };
   const legalChanged=(sellerType!==undefined&&sellerType!==owned.vendor.sellerType)
    ||(legalName!==undefined&&(legalName||null)!==owned.vendor.legalName)
    ||(voen!==undefined&&(voen||null)!==owned.vendor.voen)
    ||(legalAddress!==undefined&&(legalAddress||null)!==owned.vendor.legalAddress);
   const brandingChanges=[
     ...(values.name!==owned.name?["name"]:[]),
     ...(d.slug!==undefined&&d.slug!==owned.slug?["slug"]:[]),
    ...((values.description??null)!==owned.description?["description"]:[]),
    ...((logoUrl||null)!==owned.logoUrl?["logoUrl"]:[]),
    ...(branding.available&&(bannerUrl||null)!==branding.bannerUrl?["bannerUrl"]:[]),
    ...(branding.available&&theme!==undefined&&theme!==branding.theme?["theme"]:[]),
   ];
    try{
    const store=await db.$transaction(async(tx:any)=>{
    const updated=await tx.store.update({
     where:{id:owned.id},
     data:{
       ...values,
       ...(d.slug!==undefined?{slug:d.slug}:{}),
       ...(values.address!==undefined?{address:values.address||null}:{}),
       ...(values.contactPhone!==undefined?{contactPhone:values.contactPhone||null}:{}),
       ...(values.contactEmail!==undefined?{contactEmail:values.contactEmail?values.contactEmail.toLowerCase():null}:{}),
      ...(logoUrl!==undefined?{logoUrl:logoUrl||null}:{}),
      ...(branding.available&&bannerUrl!==undefined?{bannerUrl:bannerUrl||null}:{}),
      ...(branding.available&&theme!==undefined?{theme}:{}),
      ...(["DRAFT","REJECTED"].includes(owned.status)?{status:"DRAFT",isActive:false}:{}),
     },
      select:{id:true,name:true,slug:true},
    });
    if(Object.keys(legalPatch).length){
     await tx.vendorProfile.update({where:{id:owned.vendorId},data:legalPatch});
     if(legalChanged){
      await tx.store.updateMany({where:{vendorId:owned.vendorId},data:{legalInfoApproved:false}});
      await tx.auditLog.create({data:{actorId:access.user.id,action:"SELLER_LEGAL_INFORMATION_UPDATE",entityType:"VendorProfile",entityId:owned.vendorId,metadata:{reviewRequired:true,storeStatusesPreserved:true}}});
     }
    }
    if(brandingChanges.length){
     await tx.auditLog.create({
      data:{
       actorId:access.user.id,
       action:"SELLER_STOREFRONT_UPDATE",
       entityType:"Store",
       entityId:owned.id,
       metadata:{changedFields:brandingChanges},
      },
     });
    }
    return updated;
   });
   return NextResponse.json({
    store:{...store,bannerUrl:branding.available?bannerUrl??branding.bannerUrl:null,theme:branding.available?theme??branding.theme:"forest",storefrontBrandingAvailable:branding.available},
    message:legalChanged?"Hüquqi məlumatlar yeniləndi. Mağazanın yenidən admin yoxlamasına göndərilməsi tələb olunur.":undefined,
   });
    }catch(error){
      if(error&&typeof error==="object"&&"code" in error&&error.code==="P2002"&&d.slug!==undefined&&d.slug!==owned.slug)return NextResponse.json({error:"Mağaza ünvanı artıq istifadə olunur. Başqa ünvan seçin."},{status:409});
     throw error;
    }
 }
 return NextResponse.json({error:"Bu əməliyyat dəstəklənmir"},{status:405});
}
