import { Inbox } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SupportForm } from "@/components/support-form";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { TextLink } from "@/components/ui/text-link";
export const dynamic="force-dynamic";

type Ticket = { id: string; subject: string; message: string; status: string; createdAt: Date };
const card = "rounded-card border border-line bg-white p-5 shadow-subtle sm:p-6";

/** DESIGN-T9: page header, two calm cards and the shared empty state. Query, texts and the form flow are unchanged. */
export default async function SupportPage(){
  const user=await currentUser();
  const tickets=(user?await prisma.supportTicket.findMany({where:{userId:user.id},orderBy:{createdAt:"desc"},take:10}):[]) as Ticket[];
  return <div className="container py-8 md:py-12">
    <header className="max-w-3xl">
      <p className="text-kicker uppercase text-gold-700">BAGATI dəstək</p>
      <h1 className="mt-2 font-display text-h1 text-fg">Sizə necə kömək edə bilərik?</h1>
      <p className="mt-3 max-w-2xl text-body text-fg-secondary">Müraciətinizi göndərin. Müraciəti izləmək üçün hesabınıza daxil olun.</p>
    </header>
    <div className="mt-8 grid gap-6 lg:grid-cols-2 lg:items-start lg:gap-8">
      <section className={card}><h2 className="font-display text-h3 text-fg">Yeni müraciət</h2><SupportForm/></section>
      <section className="min-w-0"><h2 className="font-display text-h3 text-fg">Müraciətlərim</h2>
        {!user
          ?<div className={`mt-4 ${card} text-sm text-fg-secondary`}>Müraciətlərinizi görmək üçün <TextLink href="/login?next=%2Fsupport">daxil olun</TextLink>.</div>
          :tickets.length
            ?<ul className="mt-4 grid gap-3">{tickets.map((ticket)=><li key={ticket.id} className={card}>
              <div className="flex flex-wrap items-start justify-between gap-3"><h3 className="min-w-0 break-words font-semibold text-fg">{ticket.subject}</h3><Badge tone={ticket.status==="OPEN"?"gold":"neutral"}>{ticket.status==="OPEN"?"Açıq":ticket.status}</Badge></div>
              <p className="mt-2 line-clamp-3 break-words text-sm text-fg-secondary">{ticket.message}</p>
              <p className="mt-3 text-xs text-fg-muted">{ticket.createdAt.toLocaleDateString("az-AZ")}</p>
            </li>)}</ul>
            :<EmptyState className="mt-4" icon={<Inbox size={24}/>} title="Müraciət yoxdur" description="Göndərdiyiniz müraciətlər burada görünəcək."/>}
      </section>
    </div>
  </div>;
}
