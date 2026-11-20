import { getActiveCities } from "@/lib/active-cities";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CheckoutForm } from "@/components/checkout-form";
import { readEpointConfig } from "@/lib/payments/epoint-config";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { ShoppingBag } from "lucide-react";
import { Prisma } from "@prisma/client";
import { calculateStoreDelivery } from "@/lib/delivery";
import { calculateVariantEffectivePrice } from "@/lib/product-variants";
import { hasAcceptedCurrent } from "@/lib/legal-acceptance";
export const dynamic="force-dynamic";
type CartLine={id:string;quantity:number;variant:{name:string;options:any;price:Prisma.Decimal|null;discountPrice:Prisma.Decimal|null;isActive:boolean;sku:string|null}|null;product:{id:string;name:string;price:Prisma.Decimal;discountPrice:Prisma.Decimal|null;store:{id:string;name:string;freeDeliveryThreshold:Prisma.Decimal;deliveryFee:Prisma.Decimal;city:{id:string;name:string}};promotionProducts:{promotion:any}[]}};
type AddressView={id:string;cityId:string;recipientName:string;phone:string;line1:string;line2:string|null;isDefault:boolean;latitude:number|null;longitude:number|null;city:{name:string}};
type CityView={id:string;name:string};
export default async function CheckoutPage(){
  const user=await currentUser();if(!user||user.role!=="CUSTOMER")redirect("/login?next=%2Fcheckout");
  const now=new Date();
  const [cartResult,addressResult,cityResult,profile,termsAccepted]=await Promise.all([
    prisma.cart.findUnique({where:{userId:user.id},include:{items:{include:{product:{include:{store:{select:{id:true,name:true,freeDeliveryThreshold:true,deliveryFee:true,city:{select:{id:true,name:true}}}},promotionProducts:{where:{promotion:{isActive:true,startsAt:{lte:now},endsAt:{gte:now}}},include:{promotion:true}}}},variant:true}}}}),
    prisma.address.findMany({where:{userId:user.id},include:{city:{select:{name:true}}},orderBy:{isDefault:"desc"}}),
    getActiveCities().then((cities)=>cities.map(({id,name})=>({id,name}))), // cached list (SCALE-FIX-2 A6)
    prisma.customerProfile.findUnique({where:{userId:user.id}}),
    // The checkbox shows only while the CURRENT customer terms are not accepted; POST /api/orders checks again.
    hasAcceptedCurrent(prisma,user.id,"CUSTOMER_TERMS"),
  ]);
  const items=(cartResult?.items??[]) as CartLine[];const addresses=addressResult as AddressView[];const cities=cityResult as CityView[];
  if(!items.length)return <div className="container py-10 md:py-14"><h1 className="font-display text-h1 text-fg">Sifarişin rəsmiləşdirilməsi</h1><EmptyState className="mt-8" icon={<ShoppingBag size={24}/>} title="Səbətiniz boşdur" description="Sifarişə davam etmək üçün əvvəlcə məhsul seçin." action={<ButtonLink href="/products" size="sm">Məhsullara bax →</ButtonLink>}/></div>;
  const grouped=new Map<string,{id:string;name:string;cityId:string;cityName:string;freeDeliveryThreshold:unknown;deliveryFee:unknown;subtotal:Prisma.Decimal;items:{id:string;productId:string;name:string;variantName:string|null;variantOptions:unknown;quantity:number;unitPrice:number;basePrice:number;campaignName:string|null;lineTotal:number}[]}>();
  for(const item of items){
    const store=item.product.store;
    const group=grouped.get(store.id)??{id:store.id,name:store.name,cityId:store.city.id,cityName:store.city.name,freeDeliveryThreshold:store.freeDeliveryThreshold,deliveryFee:store.deliveryFee,subtotal:new Prisma.Decimal(0),items:[]};
    const effective=calculateVariantEffectivePrice({productPrice:item.product.price as any,productDiscountPrice:item.product.discountPrice as any,variant:item.variant,promotions:item.product.promotionProducts,storeId:store.id,now});
    const lineTotal=effective.unitPrice.mul(item.quantity);
    group.subtotal=group.subtotal.add(lineTotal);
    group.items.push({id:item.id,productId:item.product.id,name:item.product.name,variantName:item.variant?.name||null,variantOptions:item.variant?.options||null,quantity:item.quantity,unitPrice:effective.unitPrice.toNumber(),basePrice:effective.basePrice.toNumber(),campaignName:effective.promotion?.name||null,lineTotal:lineTotal.toNumber()});
    grouped.set(store.id,group);
  }  const stores=[...grouped.values()].map(group=>{const delivery=calculateStoreDelivery(group.subtotal,{freeDeliveryThreshold:group.freeDeliveryThreshold as Prisma.Decimal.Value,deliveryFee:group.deliveryFee as Prisma.Decimal.Value});return {...group,subtotal:group.subtotal.toNumber(),deliveryFee:delivery.deliveryFee.toNumber(),freeDelivery:delivery.freeDelivery,freeDeliveryThreshold:delivery.freeDeliveryThreshold.toNumber(),storeTotal:group.subtotal.add(delivery.deliveryFee).toNumber()}});const subtotal=stores.reduce((sum,store)=>sum+store.subtotal,0),deliveryTotal=stores.reduce((sum,store)=>sum+store.deliveryFee,0),total=stores.reduce((sum,store)=>sum+store.storeTotal,0);const name=[profile?.firstName,profile?.lastName].filter(Boolean).join(" ");  return <div className="container py-10 md:py-14"><p className="text-kicker uppercase text-gold-700">Son addım</p><h1 className="mt-2 mb-8 font-display text-h1 text-fg">Sifarişi rəsmiləşdir</h1><CheckoutForm addresses={addresses} cities={cities} stores={stores} subtotal={subtotal} deliveryTotal={deliveryTotal} total={total} customerName={name} email={user.email} epointEnabled={Boolean(readEpointConfig())} termsRequired={!termsAccepted}/></div>;
}
