/** Bildirişlər (/admin/notifications): read-only list. Moved unchanged from app/admin/[...section]/page.tsx. */
import { Filters } from "@/components/admin-list-filters";
import { prisma } from "@/lib/prisma";
import { type SectionContext, Header, Table, Pager } from "./shared";

export async function renderNotifications({ q, page, take, skip, pageQuery, shell }: SectionContext) {
  const where:any=q?{OR:[{title:{contains:q,mode:"insensitive"}},{body:{contains:q,mode:"insensitive"}},{user:{email:{contains:q,mode:"insensitive"}}}]}:{};const [rows,total]=await Promise.all([prisma.notification.findMany({where,include:{user:{select:{email:true,role:true}},store:{select:{name:true}}},orderBy:{createdAt:"desc"},skip,take}),prisma.notification.count({where})]);return shell(<><Header title="Bildirişlər"/><Filters path="/admin/notifications" q={q}/><Table rows={rows} columns={[{label:"Başlıq",cell:r=><span>{r.title}<small className="block text-slate-500">{r.body}</small></span>},{label:"Alıcı",cell:r=>`${r.user.email} · ${r.user.role}`},{label:"Mağaza",cell:r=>r.store?.name||"Ümumi"},{label:"Oxunma",cell:r=>r.readAt?`Oxunub ${r.readAt.toLocaleDateString("az-AZ")}`:"Oxunmayıb"},{label:"Tarix",cell:r=>r.createdAt.toLocaleDateString("az-AZ")} ]}/><Pager path="/admin/notifications" page={page} total={total} query={pageQuery}/></>);
}
