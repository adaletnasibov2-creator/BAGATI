/** Satıcı hesabı (/admin/vendors/:id). Moved unchanged from app/admin/[...section]/page.tsx. */
import Link from "next/link";
import { notFound } from "next/navigation";
import AdminMutationForm from "@/components/admin-mutation-form";
import { prisma } from "@/lib/prisma";
import { type SectionContext, card, Header, Table } from "./shared";

export async function renderVendorDetail({ parts, shell }: SectionContext) {
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
