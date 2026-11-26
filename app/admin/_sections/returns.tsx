/** Qaytarılma sorğuları (/admin/returns). Moved unchanged from app/admin/[...section]/page.tsx. */
import Link from "next/link";
import AdminMutationForm from "@/components/admin-mutation-form";
import { prisma } from "@/lib/prisma";
import { type SectionContext, Header, Table, Pager } from "./shared";
import { AdminStatusBadge } from "@/components/admin-ui/admin-status-badge";
import { formatMoney } from "@/lib/format-money";
import { Filters } from "@/components/admin-list-filters";
import { AdminListToolbar } from "@/components/admin-list-toolbar";
import { adminStatusOptions } from "@/lib/admin-labels";
import { ADMIN_RETURN_STATUSES, returnsListWhere } from "@/lib/admin-list-where";

// ADMIN-3-EXPORTS-1: status chips, the search box (order number, customer e-mail, store) and the CSV export, like the other
// admin lists. Pagination (25), the table and the decision form are unchanged.
export async function renderReturns({ sp, q, page, take, skip, pageQuery, shell }: SectionContext) {
  const where=returnsListWhere(sp,q);const selected=(ADMIN_RETURN_STATUSES as readonly string[]).includes(sp.status??"")?sp.status!:"";
  const [rows,total]=await Promise.all([prisma.returnRequest.findMany({where,include:{store:{select:{id:true,name:true}},storeOrder:{select:{orderId:true}},orderItem:{select:{productName:true,variantName:true,quantity:true,lineTotal:true}},customer:{select:{email:true}}},orderBy:{createdAt:"desc"},skip,take}),prisma.returnRequest.count({where})]);
  return shell(<><Header title="Qaytarılma sorğuları" detail="Admin qərarları audit jurnalında saxlanılır. Geri ödəniş statusu provayder təsdiqi olmadan tamamlanmır."/><AdminListToolbar path="/admin/returns" sp={sp} options={adminStatusOptions("return",ADMIN_RETURN_STATUSES)} selected={selected} exportList="returns"/><Filters path="/admin/returns" q={q}/><Table rows={rows} columns={[{label:"Sorğu",cell:r=><span>{r.orderItem.productName}{r.orderItem.variantName?` · ${r.orderItem.variantName}`:""}<small className="block text-fg-secondary">Sifariş #{r.storeOrder.orderId.slice(-8).toUpperCase()} · {r.orderItem.quantity} ədəd</small></span>},{label:"Müştəri",cell:r=>r.customer.email},{label:"Mağaza",cell:r=><Link href={`/admin/stores/${r.store.id}`} className="text-primary">{r.store.name}</Link>},{label:"Məbləğ",cell:r=>formatMoney(r.refundAmount)},{label:"Status",cell:r=><AdminStatusBadge kind="return" value={r.status}/>},{label:"Admin qərarı",cell:r=>r.status==="REQUESTED"?<AdminMutationForm resource="returns" method="PATCH" className="min-w-64" button="Qərarı saxla" fields={[{name:"id",label:"",type:"hidden",value:r.id},{name:"action",label:"Qərar",type:"select",required:true,options:[{value:"approve",label:"Təsdiqlə"},{value:"reject",label:"Rədd et"}]},{name:"note",label:"Daxili admin qeydi",type:"textarea",required:true}]}/>:r.adminNote||"—"} ]}/><Pager path="/admin/returns" page={page} total={total} query={pageQuery}/></>);
}
