/** Dəstək (/admin/support): ticket list. Moved unchanged from app/admin/[...section]/page.tsx. */
import Link from "next/link";
import { normalizeAdminEnumFilter } from "@/lib/admin-pagination";
import { Filters, FilterSelect } from "@/components/admin-list-filters";
import { prisma } from "@/lib/prisma";
import { type SectionContext, Header, Table, Pager, StatusForm } from "./shared";
import { adminStatusOptions } from "@/lib/admin-labels";

export async function renderSupport({ sp, q, page, take, skip, pageQuery, shell }: SectionContext) {
  const statuses=["OPEN","IN_PROGRESS","RESOLVED","CLOSED"] as const;const status=normalizeAdminEnumFilter(sp.status,statuses);const where:any={...(status?{status}:{}),...(q?{OR:[{subject:{contains:q,mode:"insensitive"}},{user:{email:{contains:q,mode:"insensitive"}}}]}:{})};const [rows,total]=await Promise.all([prisma.supportTicket.findMany({where,include:{user:{select:{email:true,role:true}}},orderBy:{createdAt:"desc"},skip,take}),prisma.supportTicket.count({where})]);return shell(<><Header title="Dəstək müraciətləri" detail="Mövcud sxemdə prioritet sahəsi yoxdur."/><Filters path="/admin/support" q={q}><FilterSelect name="status" label="Status" values={adminStatusOptions("support",statuses)} selected={sp.status}/></Filters><Table rows={rows} columns={[{label:"Müraciət",cell:r=><Link href={`/admin/support/${r.id}`} className="font-semibold text-[#173c40]">{r.subject}</Link>},{label:"Müraciətçi",cell:r=>`${r.user.email} · ${r.user.role}`},{label:"Status",cell:r=><StatusForm resource="support" id={r.id} status={r.status} options={statuses} button="Yenilə"/>},{label:"Tarix",cell:r=>r.createdAt.toLocaleDateString("az-AZ")} ]}/><Pager path="/admin/support" page={page} total={total} query={pageQuery}/></>);
}
