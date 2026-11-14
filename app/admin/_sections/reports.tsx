/** Hesabatlar (/admin/reports). Moved unchanged from app/admin/[...section]/page.tsx. */
import Link from "next/link";
import { summarizeDeliveredSales } from "@/lib/admin-sales-report";
import { summarizeMonthlyStoreSales } from "@/lib/store-monthly-sales";
import { formatLocalDateInput, parseLocalDateRange } from "@/lib/admin-report-dates";
import { FilterSelect } from "@/components/admin-list-filters";
import { prisma } from "@/lib/prisma";
import { type SectionContext, card, Header, Table } from "./shared";

export async function renderReports({ sp, shell }: SectionContext) {
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
   prisma.store.findMany({orderBy:{name:"asc"},select:{id:true,name:true}}),
   prisma.city.findMany({orderBy:{name:"asc"},select:{id:true,name:true}}),
  ]);
  const orders=rangeTooLong?[]:await prisma.storeOrder.findMany({where,include:{store:{select:{id:true,name:true}},items:true,returnRequests:{where:{status:"REFUNDED"},select:{orderItemId:true,status:true,refundAmount:true}}},orderBy:{createdAt:"asc"}});
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
