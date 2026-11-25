/** Müştərilər (/admin/customers): list. Moved from app/admin/[...section]/page.tsx; Phase B UI kit (PageHeader, responsive DataTable, empty state). */
import Link from "next/link";
import { Filters, FilterSelect } from "@/components/admin-list-filters";
import { prisma } from "@/lib/prisma";
import { customersListWhere } from "@/lib/admin-list-where";
import { AdminListToolbar } from "@/components/admin-list-toolbar";
import { type SectionContext, Pager } from "./shared";
import { PageHeader } from "@/components/admin-ui/page-header";
import { DataTable } from "@/components/admin-ui/data-table";
import { StatusBadge } from "@/components/admin-ui/status-badge";

export async function renderCustomers({ sp, q, page, take, skip, pageQuery, shell }: SectionContext) {
  // ADMIN-POWER-1: the same filter as before, shared with the CSV export (lib/admin-list-where.ts).
  const where=customersListWhere(sp,q);const [rows,total]=await Promise.all([prisma.user.findMany({where,include:{customerProfile:true,_count:{select:{orders:true}}},orderBy:{createdAt:"desc"},skip,take}),prisma.user.count({where})]);
  return shell(<><PageHeader title="Müştərilər" description="Şəxsi məlumatlar yalnız admin səlahiyyəti ilə göstərilir."/><AdminListToolbar path="/admin/customers" sp={sp} options={[{id:"active",name:"Aktiv"},{id:"inactive",name:"Deaktiv"}]} selected={sp.status==="active"||sp.status==="inactive"?sp.status:""} exportList="customers"/><Filters path="/admin/customers" q={q}><FilterSelect name="status" label="Hesab" values={[{id:"active",name:"Aktiv"},{id:"inactive",name:"Deaktiv"}]} selected={sp.status}/></Filters><DataTable rows={rows} rowKey={r=>r.id} empty="Müştəri tapılmadı." emptyDescription={q||sp.status?"Filtrləri dəyişin və ya təmizləyin.":undefined} columns={[{label:"Müştəri",cell:r=><Link href={`/admin/customers/${r.id}`} className="font-semibold text-primary hover:underline">{[r.customerProfile?.firstName,r.customerProfile?.lastName].filter(Boolean).join(" ")||r.email}</Link>},{label:"E-poçt",cell:r=>r.email},{label:"Telefon",cell:r=>r.customerProfile?.phone||"—"},{label:"Status",cell:r=><StatusBadge tone={r.isActive?"success":"neutral"}>{r.isActive?"Aktiv":"Deaktiv"}</StatusBadge>},{label:"Sifarişlər",numeric:true,cell:r=>r._count.orders},{label:"Qeydiyyat",cell:r=>r.createdAt.toLocaleDateString("az-AZ")} ]}/><Pager path="/admin/customers" page={page} total={total} query={pageQuery}/></>);
}
