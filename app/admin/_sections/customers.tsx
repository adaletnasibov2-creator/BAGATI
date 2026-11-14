/** Müştərilər (/admin/customers): list. Moved from app/admin/[...section]/page.tsx; Phase B UI kit (PageHeader, responsive DataTable, empty state). */
import Link from "next/link";
import { Filters, FilterSelect } from "@/components/admin-list-filters";
import { prisma } from "@/lib/prisma";
import { type SectionContext, Pager } from "./shared";
import { PageHeader } from "@/components/admin-ui/page-header";
import { DataTable } from "@/components/admin-ui/data-table";
import { StatusBadge } from "@/components/admin-ui/status-badge";

export async function renderCustomers({ sp, q, page, take, skip, pageQuery, shell }: SectionContext) {
  const where:any={role:"CUSTOMER",...(sp.status==="active"?{isActive:true}:sp.status==="inactive"?{isActive:false}:{}),...(q?{OR:[{email:{contains:q,mode:"insensitive"}},{customerProfile:{firstName:{contains:q,mode:"insensitive"}}},{customerProfile:{lastName:{contains:q,mode:"insensitive"}}}]}:{})};const [rows,total]=await Promise.all([prisma.user.findMany({where,include:{customerProfile:true,_count:{select:{orders:true}}},orderBy:{createdAt:"desc"},skip,take}),prisma.user.count({where})]);
  return shell(<><PageHeader title="Müştərilər" description="Şəxsi məlumatlar yalnız admin səlahiyyəti ilə göstərilir."/><Filters path="/admin/customers" q={q}><FilterSelect name="status" label="Hesab" values={[{id:"active",name:"Aktiv"},{id:"inactive",name:"Deaktiv"}]} selected={sp.status}/></Filters><DataTable rows={rows} rowKey={r=>r.id} empty="Müştəri tapılmadı." emptyDescription={q||sp.status?"Filtrləri dəyişin və ya təmizləyin.":undefined} columns={[{label:"Müştəri",cell:r=><Link href={`/admin/customers/${r.id}`} className="font-semibold text-[#173c40]">{[r.customerProfile?.firstName,r.customerProfile?.lastName].filter(Boolean).join(" ")||r.email}</Link>},{label:"E-poçt",cell:r=>r.email},{label:"Telefon",cell:r=>r.customerProfile?.phone||"—"},{label:"Sifarişlər",cell:r=>r._count.orders},{label:"Status",cell:r=><StatusBadge tone={r.isActive?"success":"neutral"}>{r.isActive?"Aktiv":"Deaktiv"}</StatusBadge>},{label:"Qeydiyyat",cell:r=>r.createdAt.toLocaleDateString("az-AZ")} ]}/><Pager path="/admin/customers" page={page} total={total} query={pageQuery}/></>);
}
