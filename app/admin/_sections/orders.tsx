/** Sifarişlər (/admin/orders): list. Moved from app/admin/[...section]/page.tsx; Phase B UI kit (PageHeader, responsive DataTable, empty state). */
import Link from "next/link";
import { Filters, FilterSelect } from "@/components/admin-list-filters";
import { ADMIN_PENDING_ORDER_GROUP } from "@/lib/admin-order-filters";
import { ordersListWhere } from "@/lib/admin-list-where";
import { prisma } from "@/lib/prisma";
import { type SectionContext, orderStatuses, Pager } from "./shared";
import { AdminStatusBadge } from "@/components/admin-ui/admin-status-badge";
import { adminStatusOptions } from "@/lib/admin-labels";
import { formatPrice } from "@/lib/price";
import { AdminListToolbar } from "@/components/admin-list-toolbar";
import { PageHeader } from "@/components/admin-ui/page-header";
import { DataTable } from "@/components/admin-ui/data-table";
import { inputClass } from "@/components/admin-ui/styles";

export async function renderOrders({ sp, q, page, take, skip, pageQuery, shell }: SectionContext) {
  // ADMIN-POWER-1: the same filter as before, shared with the CSV export (lib/admin-list-where.ts).
  const stores=await prisma.store.findMany({orderBy:{name:"asc"},select:{id:true,name:true}});const where=ordersListWhere(sp,q);const [rows,total]=await Promise.all([prisma.order.findMany({where,include:{user:{select:{id:true,email:true}},storeOrders:{include:{store:{select:{name:true}}}}},orderBy:{createdAt:"desc"},skip,take}),prisma.order.count({where})]);return shell(<><PageHeader title="Sifarişlər" description="Ümumi sifariş və mağaza sifarişlərini birlikdə idarə edin."/><AdminListToolbar path="/admin/orders" sp={sp} options={[{id:ADMIN_PENDING_ORDER_GROUP,name:"Gözləyən (bütün açıq statuslar)"},...adminStatusOptions("order",orderStatuses)]} selected={sp.status===ADMIN_PENDING_ORDER_GROUP||orderStatuses.includes(sp.status??"")?sp.status!:""} exportList="orders"/><Filters path="/admin/orders" q={q}><FilterSelect name="status" label="Status" values={[{id:ADMIN_PENDING_ORDER_GROUP,name:"Gözləyən (bütün açıq statuslar)"},...adminStatusOptions("order",orderStatuses)]} selected={sp.status}/><FilterSelect name="storeId" label="Mağaza" values={stores} selected={sp.storeId}/><label className="grid gap-1.5 text-xs font-medium text-fg-secondary max-sm:flex-1">Başlanğıc<input type="date" name="from" defaultValue={sp.from||""} className={inputClass}/></label><label className="grid gap-1.5 text-xs font-medium text-fg-secondary max-sm:flex-1">Son tarix<input type="date" name="to" defaultValue={sp.to||""} className={inputClass}/></label></Filters><DataTable rows={rows} rowKey={r=>r.id} empty="Sifariş tapılmadı." emptyDescription={q||sp.status||sp.storeId||sp.from||sp.to?"Filtrləri dəyişin və ya təmizləyin.":undefined} columns={[{label:"Sifariş",cell:r=><Link href={`/admin/orders/${r.id}`} className="font-semibold text-primary hover:underline">#{r.id.slice(-8).toUpperCase()}</Link>},{label:"Müştəri",cell:r=><Link href={`/admin/customers/${r.user.id}`} className="text-primary hover:underline">{r.user.email}</Link>},{label:"Mağazalar",cell:r=>r.storeOrders.map((s:any)=>s.store.name).join(", ")},{label:"Status",cell:r=><AdminStatusBadge kind="order" value={r.status}/>},{label:"Cəmi",numeric:true,cell:r=>formatPrice(r.total)},{label:"Tarix",cell:r=>r.createdAt.toLocaleDateString("az-AZ")} ]}/><Pager path="/admin/orders" page={page} total={total} query={pageQuery}/></>);
}
