/** Satıcılar (/admin/vendors): list. Moved unchanged from app/admin/[...section]/page.tsx. */
import Link from "next/link";
import { Filters } from "@/components/admin-list-filters";
import { prisma } from "@/lib/prisma";
import { type SectionContext, Header, Table, Pager } from "./shared";

export async function renderVendors({ q, page, take, skip, pageQuery, shell }: SectionContext) {
  const where:any=q?{OR:[{displayName:{contains:q,mode:"insensitive"}},{user:{email:{contains:q,mode:"insensitive"}}}]}:{};const [rows,total]=await Promise.all([prisma.vendorProfile.findMany({where,include:{user:{select:{id:true,email:true,isActive:true,createdAt:true}},stores:{select:{id:true,status:true,isActive:true,subscription:{select:{status:true}}}}},orderBy:{user:{createdAt:"desc"}},skip,take}),prisma.vendorProfile.count({where})]);
  return shell(<><Header title="Satıcılar" detail="Satıcı hesabları, onların mağazaları və abunəlik vəziyyəti."/><div className="mb-4"><Link className="rounded-lg bg-[#173c40] px-4 py-2.5 text-sm font-semibold text-white" href="/admin/vendors/new">+ Satıcı hesabı yarat</Link></div><Filters path="/admin/vendors" q={q}/><Table rows={rows} columns={[{label:"Satıcı",cell:r=><Link href={`/admin/vendors/${r.id}`} className="font-semibold text-[#173c40]">{r.displayName}</Link>},{label:"E-poçt",cell:r=>r.user.email},{label:"Mağazalar",cell:r=>r.stores.length},{label:"Aktiv",cell:r=>r.stores.filter((s:any)=>s.isActive).length},{label:"Abunəliklər",cell:r=>r.stores.map((s:any)=>s.subscription?.status||"yoxdur").join(", ")||"—"},{label:"Qeydiyyat",cell:r=>r.user.createdAt.toLocaleDateString("az-AZ")} ]}/><Pager path="/admin/vendors" page={page} total={total} query={pageQuery}/></>);
}
