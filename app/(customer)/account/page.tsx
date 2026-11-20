import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AccountShell, accountCard } from "@/components/account-shell";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { orderStatusTone } from "@/lib/vendor-status-tone";
import { Package } from "lucide-react";
import { customerMessagesBadge } from "@/lib/messaging-pages";
import { EmptyState } from "@/components/ui/empty-state";
import { statusLabel } from "@/lib/order-status";
export const dynamic="force-dynamic";
export default async function AccountPage(){const user=await currentUser();if(!user||user.role!=="CUSTOMER")redirect("/login?next=%2Faccount");const [profile,ordersResult,messagesUnread]=await Promise.all([prisma.customerProfile.findUnique({where:{userId:user.id}}),prisma.order.findMany({where:{userId:user.id},select:{id:true,status:true,total:true,createdAt:true,_count:{select:{storeOrders:true}}},orderBy:{createdAt:"desc"},take:3}),customerMessagesBadge(user.id)]);const orders=ordersResult as {id:string;status:string;total:unknown;createdAt:Date;_count:{storeOrders:number}}[];return <AccountShell eyebrow="Şəxsi kabinet" title={<>Salam{profile?.firstName?`, ${profile.firstName}`:""}</>} messagesUnread={messagesUnread}><div className="space-y-7">
    <section className={accountCard}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="font-display text-h3 text-fg">Hesab məlumatları</h2><p className="mt-2 break-words text-sm text-fg-secondary">{user.email}</p><p className="mt-1 text-sm text-fg-secondary">{[profile?.firstName,profile?.lastName].filter(Boolean).join(" ")||"Ad və soyad əlavə edilməyib"}</p></div><Link href="/account/profile" className={buttonClass({variant:"secondary",size:"sm"})}>Profili redaktə et →</Link></div></section>
    <section><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="font-display text-h2 text-fg">Son sifarişlər</h2><Link href="/orders" className="inline-flex min-h-11 items-center rounded-sm text-sm font-medium text-primary hover:text-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Hamısına bax →</Link></div>{orders.length?<ul className="space-y-3">{orders.map((order:{id:string;status:string;total:unknown;createdAt:Date;_count:{storeOrders:number}})=><li key={order.id}><Link href={`/orders/${order.id}`} data-account-order-card="" className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-white p-5 transition-colors hover:border-brand-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"><div className="min-w-0"><p className="font-semibold text-fg">Sifariş · {order.id.slice(-8).toUpperCase()}</p><p className="mt-1 text-sm text-fg-muted">{order.createdAt.toLocaleDateString("az-AZ")} · {order._count.storeOrders} mağaza</p></div><div className="flex items-center gap-3"><Badge tone={orderStatusTone(order.status)}>{statusLabel(order.status)}</Badge><p className="font-semibold text-fg">{Number(order.total).toFixed(2)} ₼</p></div></Link></li>)}</ul>:<EmptyState icon={<Package size={24}/>} title="Hələ sifariş yoxdur" description="Sifariş verdikdən sonra məlumatlarınız burada görünəcək."/>}</section>
  </div></AccountShell>
}
