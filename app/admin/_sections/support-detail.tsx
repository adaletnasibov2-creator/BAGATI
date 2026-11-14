/** Dəstək müraciəti (/admin/support/:id). Moved unchanged from app/admin/[...section]/page.tsx. */
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { type SectionContext, card, Header, StatusForm } from "./shared";

export async function renderSupportDetail({ parts, shell }: SectionContext) {
  const ticket=await prisma.supportTicket.findUnique({where:{id:parts[1]},include:{user:{select:{id:true,email:true,role:true}}}});if(!ticket)notFound();return shell(<><Header title={ticket.subject} detail={`${ticket.user.email} · ${ticket.user.role} · ${ticket.createdAt.toLocaleString("az-AZ")}`}/><section className={card}><p className="whitespace-pre-wrap text-sm leading-6">{ticket.message}</p><div className="mt-5 border-t pt-4"><StatusForm resource="support" id={ticket.id} status={ticket.status} options={["OPEN","IN_PROGRESS","RESOLVED","CLOSED"]} button="Statusu yenilə"/></div></section></>)
}
