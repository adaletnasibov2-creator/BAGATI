/** Komissiyalar (/admin/commissions). Moved unchanged from app/admin/[...section]/page.tsx. */
import Link from "next/link";
import AdminMutationForm, { type AdminField } from "@/components/admin-mutation-form";
import { prisma } from "@/lib/prisma";
import { loadSettingSummary } from "@/lib/settings/admin";
import { SETTING_KEYS } from "@/lib/settings/registry";
import { commissionRateToPercent } from "@/lib/commission-rules";
import { type SectionContext, card, Header, Table, Pager } from "./shared";

export async function renderCommissions({ page, take, skip, pageQuery, shell }: SectionContext) {
  const [rows, total, stores, defaultCommission] = await Promise.all([
   prisma.commission.findMany({ include: { store: { select: { id: true, name: true } } }, orderBy: { startsAt: "desc" }, skip, take }),
   prisma.commission.count(),
   prisma.store.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
   loadSettingSummary(prisma, SETTING_KEYS.commissionDefaultRate),
  ]);
  const storeOptions = stores.map((store: any) => ({ value: store.id, label: store.name }));
  const createFields: AdminField[] = [
   { name: "storeId", label: "Mağaza", type: "select", options: storeOptions, required: true },
   { name: "ratePercent", label: "Komissiya faizi (%)", type: "number", min: "0", max: "100", step: "0.01", placeholder: "məsələn 10", required: true },
   { name: "startsAt", label: "Başlanğıc tarixi", type: "date", value: new Date().toISOString().slice(0, 10), required: true },
   { name: "endsAt", label: "Son tarix", type: "date" },
  ];
  return shell(<>
   <Header title="Komissiyalar" detail="Komissiya faizi və tətbiq müddəti sxemdəki real məlumatlardır." />
   <section className={`${card} mb-5 flex flex-wrap items-center justify-between gap-3`} aria-label="Standart komissiya">
    <div className="min-w-0">
     <p className="text-sm font-semibold text-[#0d1b2a]">Standart komissiya: {defaultCommission.display}</p>
     <p className="mt-1 text-sm text-slate-600">{defaultCommission.isSet ? "Öz qaydası olmayan mağazaların yeni sifarişlərinə tətbiq olunur. Aşağıdakı mağaza qaydaları üstündür." : "Öz qaydası olmayan mağazaların sifarişlərində komissiya qeydə alınmır. Aşağıdakı mağaza qaydaları üstündür."}</p>
    </div>
    <Link href="/admin/settings?tab=finance" className="rounded-xl border border-[#ded9cf] px-4 py-2.5 text-sm font-semibold text-[#173c40]">Maliyyə parametrlərinə keç</Link>
   </section>
   <section className={card}>
    <h2 className="mb-3 font-semibold">Komissiya əlavə et</h2>
    <AdminMutationForm resource="commissions" fields={createFields} button="Yarat" />
   </section>
   <div className="mt-5">
    <Table rows={rows} columns={[
     { label: "Mağaza", cell: (row) => <Link className="text-[#173c40]" href={`/admin/stores/${row.store.id}`}>{row.store.name}</Link> },
     { label: "Faiz", cell: (row) => `${(Number(row.rate) * 100).toFixed(2)}%` },
     { label: "Başlanğıc", cell: (row) => row.startsAt.toLocaleDateString("az-AZ") },
     { label: "Son", cell: (row) => row.endsAt?.toLocaleDateString("az-AZ") || "Davam edir" },
     {
      label: "Dəyişiklik",
      cell: (row) => <AdminMutationForm
       resource="commissions"
       method="PATCH"
       className="min-w-64"
       button="Yadda saxla"
       fields={[
        { name: "id", label: "", type: "hidden", value: row.id },
        { name: "storeId", label: "Mağaza", type: "select", value: row.storeId, options: storeOptions, required: true },
        { name: "ratePercent", label: "Faiz (%)", type: "number", value: commissionRateToPercent(row.rate), min: "0", max: "100", step: "0.01", required: true },
        { name: "startsAt", label: "Başlanğıc", type: "date", value: row.startsAt.toISOString().slice(0, 10), required: true },
        { name: "endsAt", label: "Son", type: "date", value: row.endsAt?.toISOString().slice(0, 10) || "" },
       ]}
      />,
     },
    ]} />
   </div>
   <Pager path="/admin/commissions" page={page} total={total} query={pageQuery} />
  </>);
}
