/** Satıcı hesabı (/admin/vendors/:id). Moved unchanged from app/admin/[...section]/page.tsx. */
import Link from "next/link";
import { notFound } from "next/navigation";
import AdminMutationForm from "@/components/admin-mutation-form";
import { prisma } from "@/lib/prisma";
import { type SectionContext, card, Table } from "./shared";
import { AdminDetailHeader } from "@/components/admin-ui/detail-header";
import { StatusBadge } from "@/components/admin-ui/status-badge";
import { ADMIN_BACK_LINKS } from "@/lib/admin-power-1";
import { AdminStatusBadge } from "@/components/admin-ui/admin-status-badge";
import { adminStatusLabel } from "@/lib/admin-labels";
import { AdminLegalAcceptances, adminLegalAcceptanceSelect } from "@/components/admin-legal-acceptances";

export async function renderVendorDetail({ parts, shell }: SectionContext) {
   const vendorId = parts[1];
   const vendor = await prisma.vendorProfile.findUnique({
    where: { id: vendorId },
    select: {
     id: true,
     displayName: true,
     user: { select: { id: true, email: true, isActive: true, createdAt: true, legalAcceptances: { select: adminLegalAcceptanceSelect, orderBy: { acceptedAt: "desc" } } } },
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
    <AdminDetailHeader back={ADMIN_BACK_LINKS.vendors} title={vendor.displayName || "Satıcı adı yoxdur"} detail={vendor.user.email + " · Satıcı hesabı"} badge={<StatusBadge tone={vendor.user.isActive ? "success" : "neutral"}>{vendor.user.isActive ? "Aktiv" : "Deaktiv"}</StatusBadge>} facts={[["Qeydiyyat", vendor.user.createdAt.toLocaleDateString("az-AZ")], ["Mağazalar", vendor._count.stores]]}/>
    <section className={card + " mb-5"}>
     <p>Hesab statusu: <b>{vendor.user.isActive ? "Aktiv" : "Deaktiv"}</b> · Qeydiyyat: {vendor.user.createdAt.toLocaleDateString("az-AZ")}</p>
     <AdminMutationForm resource="users" method="PATCH" fields={[{name:"id",label:"",type:"hidden",value:vendor.user.id},{name:"isActive",label:vendor.user.isActive?"Hesabı deaktiv et":"Hesabı aktiv et",type:"checkbox",value:!vendor.user.isActive}]} button="Hesab statusunu dəyiş" confirmMessage="Satıcı hesabının statusunu dəyişmək istəyirsiniz?"/>
    </section>
    <AdminLegalAcceptances rows={vendor.user.legalAcceptances} className={card + " mb-5"}/>
    <h2 className="mb-3 text-h3 text-fg">Mağazalar ({vendor.stores.length} / {vendor._count.stores})</h2>
    <Table rows={vendor.stores} empty="Bu satıcıya aid mağaza yoxdur." columns={[
     {label:"Mağaza",cell:r=><Link href={"/admin/stores/" + r.id} className="font-semibold text-primary hover:underline">{r.name}</Link>},
     {label:"Şəhər",cell:r=>r.city?.name || "Şəhər yoxdur"},
     {label:"Status / görünürlük",cell:r=><span><AdminStatusBadge kind="store" value={r.status}/> · {r.status === "ACTIVE" && r.isActive ? "ictimai görünür" : "ictimai gizlidir"}</span>},
     {label:"Abunəlik",cell:r=>r.subscription ? (r.subscription.plan?.name || "Plan yoxdur") + " · " + adminStatusLabel("subscription", r.subscription.status) : "Abunəlik yoxdur"},
     {label:"Məhsul / sifariş",cell:r=>r._count.products + " / " + r._count.storeOrders},
    ]}/>
    {vendor._count.stores > vendor.stores.length && <p className="mt-3 text-xs text-slate-500">Siyahıda ən son 50 mağaza göstərilir.</p>}
   </>);
}
