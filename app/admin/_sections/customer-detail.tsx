/** Müştəri məlumatı (/admin/customers/:id). Moved unchanged from app/admin/[...section]/page.tsx. */
import { notFound } from "next/navigation";
import AdminMutationForm from "@/components/admin-mutation-form";
import { prisma } from "@/lib/prisma";
import { type SectionContext, card } from "./shared";
import { AdminDetailHeader } from "@/components/admin-ui/detail-header";
import { StatusBadge } from "@/components/admin-ui/status-badge";
import { ADMIN_BACK_LINKS } from "@/lib/admin-power-1";
import { AdminLegalAcceptances, adminLegalAcceptanceSelect } from "@/components/admin-legal-acceptances";

export async function renderCustomerDetail({ parts, shell }: SectionContext) {
  const user=await prisma.user.findFirst({where:{id:parts[1],role:"CUSTOMER"},include:{customerProfile:true,addresses:{include:{city:true}},_count:{select:{orders:true}},legalAcceptances:{select:adminLegalAcceptanceSelect,orderBy:{acceptedAt:"desc"}}}});if(!user)notFound();return shell(<><AdminDetailHeader back={ADMIN_BACK_LINKS.customers} title="Müştəri məlumatı" detail={user.email} badge={<StatusBadge tone={user.isActive?"success":"neutral"}>{user.isActive?"Aktiv":"Deaktiv"}</StatusBadge>} facts={[["Telefon",user.customerProfile?.phone||"—"],["Sifariş sayı",user._count.orders],["Qeydiyyat",user.createdAt.toLocaleDateString("az-AZ")]]}/><section className={`${card} mb-5`}><div className="grid gap-3 text-sm sm:grid-cols-2"><p>Ad: {user.customerProfile?.firstName||"—"} {user.customerProfile?.lastName||""}</p><p>Telefon: {user.customerProfile?.phone||"—"}</p><p>Hesab: {user.isActive?"Aktiv":"Deaktiv"}</p><p>Sifariş sayı: {user._count.orders}</p><p>Qeydiyyat: {user.createdAt.toLocaleDateString("az-AZ")}</p></div><AdminMutationForm resource="users" method="PATCH" className="mt-4" fields={[{name:"id",label:"",type:"hidden",value:user.id},{name:"isActive",label:user.isActive?"Hesabı deaktiv et":"Hesabı aktiv et",type:"checkbox",value:!user.isActive}]} button="Statusu dəyiş" confirmMessage="Müştəri hesabının statusunu dəyişmək istəyirsiniz?"/></section><AdminLegalAcceptances rows={user.legalAcceptances} className={`${card} mb-5`}/><h2 className="mb-3 text-h3 text-fg">Çatdırılma ünvanları</h2><div className="grid gap-3 sm:grid-cols-2">{user.addresses.map((a:any)=><article key={a.id} className={card}><b>{a.label||a.recipientName}</b><p className="mt-2 text-sm text-slate-500">{a.line1} {a.line2||""} · {a.city.name}</p></article>)}</div></>)
}
