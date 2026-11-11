import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolvePublicProductEligibility } from "@/lib/store-eligibility";
import { calculateStoreDelivery } from "@/lib/delivery";
import { createOrderAddressSnapshot } from "@/lib/order-address-snapshot";
import { calculateVariantEffectivePrice, orderVariantSnapshot, quantityAfterSale, resolveVariantInventory } from "@/lib/product-variants";
import { enqueueEmail } from "@/lib/email-outbox";
import { stockAlertCrossing, stockAlertNotification, VENDOR_NOTIFICATION_TITLES } from "@/lib/vendor-notifications";
import { listCustomerOrderPage, parseCustomerOrderPageSize } from "@/lib/customer-order-pagination";
const db: any = prisma;
const schema = z.object({ addressId: z.string().min(1), latitude: z.number().finite().min(-90).max(90).nullable().optional(), longitude: z.number().finite().min(-180).max(180).nullable().optional(), expectedPrices: z.array(z.object({ cartItemId: z.string().min(1), unitPrice: z.number().positive() })).max(500).optional() });
export async function GET(request: NextRequest) {
 const user=await requireRole("CUSTOMER"); if(!user)return NextResponse.json({error:"Authentication required"},{status:401});
 const pageSize = parseCustomerOrderPageSize(request.nextUrl.searchParams.get("pageSize"));
 if (pageSize === null) return NextResponse.json({ error: "Səhifə ölçüsü yanlışdır" }, { status: 400 });
 const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
 try {
  const page = await listCustomerOrderPage(prisma, user.id, { cursor, pageSize });
  return NextResponse.json({ items: page.items, pagination: { pageSize: page.pageSize, hasNext: page.hasNext, hasPrevious: page.hasPrevious, nextCursor: page.nextCursor, previousCursor: page.previousCursor } });
 } catch (error) {
  if (error instanceof RangeError && error.message === "CUSTOMER_ORDER_CURSOR_INVALID") return NextResponse.json({ error: "Səhifələmə keçidi yanlışdır" }, { status: 400 });
  throw error;
 }
}
export async function POST(request:NextRequest) {
 const user=await requireRole("CUSTOMER"); if(!user)return NextResponse.json({error:"Authentication required"},{status:401});
 let raw:unknown;try{raw=await request.json()}catch{return NextResponse.json({error:"Invalid JSON"},{status:400})}
 const parsed=schema.safeParse(raw);if(!parsed.success)return NextResponse.json({error:"A delivery address is required"},{status:400});
 const now=new Date();
 if((parsed.data.latitude==null)!==(parsed.data.longitude==null))return NextResponse.json({error:"Xəritə koordinatları birlikdə daxil edilməlidir"},{status:422});
 try {
  const order=await db.$transaction(async(transaction:any)=>{
   const tx:any=transaction;
   const activeCustomer=await tx.user.findFirst({where:{id:user.id,role:"CUSTOMER",isActive:true},select:{id:true}});if(!activeCustomer)throw new Error("SESSION_EXPIRED");
   const address=await tx.address.findFirst({where:{id:parsed.data.addressId,userId:user.id},include:{city:{select:{id:true,name:true,isActive:true}}}});if(!address||!address.city.isActive)throw new Error("ADDRESS_INVALID");
   await tx.$queryRawUnsafe('SELECT "id" FROM "Cart" WHERE "userId" = $1 FOR UPDATE',user.id);
    const cart=await tx.cart.findUnique({where:{userId:user.id},include:{items:{include:{variant:true,product:{include:{store:{select:{id:true,name:true,freeDeliveryThreshold:true,deliveryFee:true,vendor:{select:{user:{select:{id:true,email:true}}}}}},inventory:true,variants:{select:{id:true,productId:true,isActive:true}},promotionProducts:{where:{promotion:{isActive:true,startsAt:{lte:now},endsAt:{gte:now}}},include:{promotion:true}}}}}}}});
   const items:any[]=cart?.items??[];if(!items.length)throw new Error("CART_EMPTY");
   const productCandidates=[...new Map(items.map((item:any)=>[item.product.id,item.product])).values()];
   const eligibleProductIds=await resolvePublicProductEligibility(productCandidates,tx,now);if(productCandidates.some((product:any)=>!eligibleProductIds.has(product.id)))throw new Error("STORE_UNAVAILABLE");
    const expectedPriceMap=new Map((parsed.data.expectedPrices||[]).map(row=>[row.cartItemId,new Prisma.Decimal(row.unitPrice)]));if(parsed.data.expectedPrices&&expectedPriceMap.size!==parsed.data.expectedPrices.length)throw new Error("PRICE_CHANGED");
    const normalized=items.map((item:any)=>{
    const product=item.product;if(product.status!=="ACTIVE")throw new Error("PRODUCT_UNAVAILABLE");
    if(item.variantId&&(!item.variant||item.variant.productId!==product.id))throw new Error("VARIANT_INVALID");
    const resolved=resolveVariantInventory(product.id,item.variantId,product.variants,product.inventory,item.quantity);
    const effective=calculateVariantEffectivePrice({productPrice:product.price,productDiscountPrice:product.discountPrice,variant:item.variant,promotions:product.promotionProducts,storeId:product.store.id,now});const price=effective.basePrice,unitPrice=effective.unitPrice;if(!price.isFinite()||price.lte(0)||!unitPrice.isFinite()||unitPrice.lte(0))throw new Error("PRICE_INVALID");const expected=expectedPriceMap.get(item.id);if(expected&&!expected.eq(unitPrice))throw new Error("PRICE_CHANGED");
    return {item,inventoryId:resolved.inventory.id,unitPrice,lineTotal:unitPrice.mul(item.quantity)};
   });
   // Lock inventory rows in a stable order to reduce checkout deadlocks.
   normalized.sort((a:any,b:any)=>a.inventoryId.localeCompare(b.inventoryId));
   const stockAlerts:{userId:string;storeId:string;title:string;body:string}[]=[];
   for(const row of normalized){
    await tx.$queryRawUnsafe('SELECT "id" FROM "Inventory" WHERE "id" = $1 FOR UPDATE',row.inventoryId);
    const current=await tx.inventory.findUnique({where:{id:row.inventoryId}});if(!current)throw new Error("STOCK_CHANGED");try{quantityAfterSale(current.quantity,current.reserved,row.item.quantity)}catch{throw new Error("STOCK_CHANGED")}
    const changed=await tx.inventory.updateMany({where:{id:current.id,quantity:{gte:current.reserved+row.item.quantity},reserved:current.reserved},data:{quantity:{decrement:row.item.quantity}}});if(changed.count!==1)throw new Error("STOCK_CHANGED");
    await tx.inventoryAdjustment.create({data:{inventoryId:current.id,actorUserId:user.id,delta:-row.item.quantity,previousQuantity:current.quantity,newQuantity:current.quantity-row.item.quantity,reason:"Customer order stock deduction"}});
    const crossing=stockAlertCrossing(current.quantity-current.reserved,current.quantity-row.item.quantity-current.reserved,current.lowStockThreshold);
    const vendorUserId=row.item.product.store.vendor?.user?.id;
    if(crossing&&vendorUserId)stockAlerts.push({userId:vendorUserId,storeId:row.item.product.store.id,...stockAlertNotification(crossing,row.item.variant?.name?`${row.item.product.name} (${row.item.variant.name})`:row.item.product.name,Math.max(0,current.quantity-row.item.quantity-current.reserved))});
   }
   const groups=new Map<string,any[]>();for(const row of normalized){const storeId=row.item.product.store.id;groups.set(storeId,[...(groups.get(storeId)??[]),row]);}
    const storeOrders=[...groups.entries()].map(([storeId,lines])=>{const store=lines[0].item.product.store;const storeSubtotal=lines.reduce((sum:Prisma.Decimal,row:any)=>sum.add(row.lineTotal),new Prisma.Decimal(0));const delivery=calculateStoreDelivery(storeSubtotal,{freeDeliveryThreshold:store.freeDeliveryThreshold,deliveryFee:store.deliveryFee});return {storeId,subtotal:storeSubtotal,deliveryFee:delivery.deliveryFee,storeTotal:storeSubtotal.add(delivery.deliveryFee),lines};});
    const orderCreatedAt=new Date();
    const commissionRules = await tx.commission.findMany({
     where: { storeId: { in: storeOrders.map((group:any)=>group.storeId) }, startsAt: { lte: orderCreatedAt }, OR: [{ endsAt: null }, { endsAt: { gt: orderCreatedAt } }] },
     orderBy: { startsAt: "desc" },
     select: { storeId: true, rate: true },
    });
    const commissionRateByStore = new Map<string, Prisma.Decimal>();
    for (const rule of commissionRules) if (!commissionRateByStore.has(rule.storeId)) commissionRateByStore.set(rule.storeId, rule.rate);
    const subtotal=storeOrders.reduce((sum,group)=>sum.add(group.subtotal),new Prisma.Decimal(0));
    const totalDeliveryFee=storeOrders.reduce((sum,group)=>sum.add(group.deliveryFee),new Prisma.Decimal(0));
    const total=subtotal.add(totalDeliveryFee);
    const hasCoordinates=Object.prototype.hasOwnProperty.call(parsed.data,"latitude");
    const selectedCoordinates=hasCoordinates?(parsed.data.latitude==null?null:{latitude:parsed.data.latitude,longitude:parsed.data.longitude!}):undefined;
    const addressSnapshot=createOrderAddressSnapshot(address,selectedCoordinates);
     const created=await tx.order.create({data:{userId:user.id,status:"PENDING",subtotal,deliveryFee:totalDeliveryFee,total,addressSnapshot,storeOrders:{create:storeOrders.map(group=>({storeId:group.storeId,status:"NEW",createdAt:orderCreatedAt,subtotal:group.subtotal,commissionRateSnapshot:commissionRateByStore.get(group.storeId)??null,deliveryFee:group.deliveryFee,items:{create:group.lines.map((row:any)=>({productId:row.item.productId,variantId:row.item.variantId,...orderVariantSnapshot(row.item.variant),productName:row.item.product.name,sku:row.item.variant?.sku??row.item.product.sku,unitPrice:row.unitPrice,quantity:row.item.quantity,lineTotal:row.lineTotal}))}}))},payments:{create:{amount:total,currency:"AZN",status:"PENDING"}}},include:{storeOrders:{include:{store:{select:{id:true,name:true,vendor:{select:{user:{select:{id:true,email:true}}}}}},items:true}},payments:true}});
   const customer=await tx.user.findUnique({where:{id:user.id},select:{email:true}});
   if(customer)await enqueueEmail(tx,{eventKey:`order-confirmed:${created.id}:${customer.email}`,recipient:customer.email,template:"CUSTOMER_ORDER_CONFIRMED",payload:{orderRef:created.id,total:Number(created.total)}});
   for(const storeOrder of created.storeOrders){
    const sellerEmail=storeOrder.store.vendor.user.email;
    await enqueueEmail(tx,{eventKey:`seller-new-order:${storeOrder.id}:${sellerEmail}`,recipient:sellerEmail,template:"SELLER_NEW_ORDER",payload:{storeName:storeOrder.store.name,orderRef:created.id,storeOrderRef:storeOrder.id,total:Number(storeOrder.subtotal)+Number(storeOrder.deliveryFee)}});
    // In-app seller notification; created in this transaction so a rolled-back or retried checkout cannot duplicate it.
    const sellerUserId=storeOrder.store.vendor.user.id;
    if(sellerUserId)await tx.notification.create({data:{userId:sellerUserId,storeId:storeOrder.storeId,title:VENDOR_NOTIFICATION_TITLES.newOrder,body:`Sifariş #${created.id.slice(-8).toUpperCase()} · ${storeOrder.items.length} məhsul · ${(Number(storeOrder.subtotal)+Number(storeOrder.deliveryFee)).toFixed(2)} AZN. Sifarişi təsdiqləyin və ya rədd edin.`}});
   }
   for(const alert of stockAlerts)await tx.notification.create({data:alert});
   if(cart)await tx.cartItem.deleteMany({where:{cartId:cart.id}});return created;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:10000,timeout:20000});
  return NextResponse.json({order},{status:201});
 }catch(error){
  if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==="P2034")return NextResponse.json({error:"Sifariş zamanı uyğunluq və ya stok məlumatları dəyişdi. Səbəti yeniləyib yenidən cəhd edin.",code:"TRANSACTION_CONFLICT"},{status:409});
  const code=error instanceof Error?error.message:"ERROR";
  const messages:Record<string,string>={SESSION_EXPIRED:"Sessiya bitib. Yenidən daxil olun.",ADDRESS_INVALID:"Çatdırılma ünvanı tapılmadı və ya şəhər artıq aktiv deyil.",CART_EMPTY:"Səbət boşdur.",STORE_UNAVAILABLE:"Səbətdəki mağazalardan biri hazırda sifariş qəbul etmir. Səbəti yeniləyin.",PRODUCT_UNAVAILABLE:"Məhsul artıq satışda deyil. Səbəti yeniləyin.",VARIANT_INVALID:"Seçilmiş variant artıq mövcud deyil.",PRICE_INVALID:"Məhsulun qiyməti dəyişib və ya yanlışdır. Səbəti yeniləyin.",PRICE_CHANGED:"Məhsulun qiyməti dəyişib. Səbəti və sifariş məbləğini yeniləyin.",STOCK_CHANGED:"Stok dəyişib. Səbəti yeniləyib yenidən yoxlayın."};
  const status=code==="CART_EMPTY"||code==="STOCK_CHANGED"?409:code==="ADDRESS_INVALID"?404:code==="SESSION_EXPIRED"?401:code in messages?409:500;
  return NextResponse.json({error:messages[code]||"Sifaris yaradilma. Bir az sonra yeniden yoxlayin.",code},{status});
 }
}
