/** Müştəri məlumatı (/admin/customers/:id). Moved unchanged from app/admin/[...section]/page.tsx. */
import { notFound } from "next/navigation";
import AdminMutationForm from "@/components/admin-mutation-form";
import { prisma } from "@/lib/prisma";
import { type SectionContext, card, Header } from "./shared";

export async function renderCustomerDetail({ parts, shell }: SectionContext) {
  const user=await prisma.user.findFirst({where:{id:parts[1],role:"CUSTOMER"},include:{customerProfile:true,addresses:{include:{city:true}},_count:{select:{orders:true}}}});if(!user)notFound();return shell(<><Header title="Müştəri məlumatı" detail={user.email}/><section className={`${card} mb-5`}><div className="grid gap-3 text-sm sm:grid-cols-2"><p>Ad: {user.customerProfile?.firstName||"—"} {user.customerProfile?.lastName||""}</p><p>Telefon: {user.customerProfile?.phone||"—"}</p><p>Hesab: {user.isActive?"Aktiv":"Deaktiv"}</p><p>Sifariş sayı: {user._count.orders}</p><p>Qeydiyyat: {user.createdAt.toLocaleDateString("az-AZ")}</p></div><AdminMutationForm resource="users" method="PATCH" className="mt-4" fields={[{name:"id",label:"",type:"hidden",value:user.id},{name:"isActive",label:user.isActive?"Hesabı deaktiv et":"Hesabı aktiv et",type:"checkbox",value:!user.isActive}]} button="Statusu dəyiş" confirmMessage="Müştəri hesabının statusunu dəyişmək istəyirsiniz?"/></section><h2 className="mb-3 font-semibold">Çatdırılma ünvanları</h2><div className="grid gap-3 sm:grid-cols-2">{user.addresses.map((a:any)=><article key={a.id} className={card}><b>{a.label||a.recipientName}</b><p className="mt-2 text-sm text-slate-500">{a.line1} {a.line2||""} · {a.city.name}</p></article>)}</div></>)
}
