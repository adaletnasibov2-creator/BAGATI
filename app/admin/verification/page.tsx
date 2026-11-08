import Link from "next/link";
import { redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const card = "rounded-2xl border border-[#e7e3d9] bg-white p-5";

export default async function AdminVerificationPage() {
  const admin = await requireRole("ADMIN");
  if (!admin) redirect("/admin/login");

  const [customers, vendors, customerCount, vendorCount] = await Promise.all([
    prisma.user.findMany({
      where: { role: "CUSTOMER", isActive: true, emailVerifiedAt: null },
      select: { id: true, email: true, createdAt: true, emailVerification: { select: { expiresAt: true, attempts: true, updatedAt: true } }, customerProfile: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "asc" },
      take: 50,
    }),
    prisma.user.findMany({
      where: { role: "VENDOR", isActive: true, emailVerifiedAt: null },
      select: { id: true, email: true, createdAt: true, emailVerification: { select: { expiresAt: true, attempts: true, updatedAt: true } }, vendorProfile: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: "asc" },
      take: 50,
    }),
    prisma.user.count({ where: { role: "CUSTOMER", isActive: true, emailVerifiedAt: null } }),
    prisma.user.count({ where: { role: "VENDOR", isActive: true, emailVerifiedAt: null } }),
  ]);

  const accountRows = [
    ...customers.map(user => ({ ...user, name: [user.customerProfile?.firstName, user.customerProfile?.lastName].filter(Boolean).join(" "), role: "customer" as const, detailId: user.id })),
    ...vendors.map(user => ({ ...user, name: user.vendorProfile?.displayName || "", role: "vendor" as const, detailId: user.vendorProfile?.id ?? null })),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return <AdminShell email={admin.email}>
    <header className="mb-6">
      <p className="text-xs font-semibold uppercase tracking-[.18em] text-[#9b7840]">BAGATI · ADMIN</p>
      <h1 className="mt-2 text-3xl font-semibold text-[#0d1b2a]">Email təsdiqi gözləyən hesablar</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-500">Bu siyahı aktiv, təsdiqlənməmiş müştəri və satıcı hesablarını göstərir. Kodun növbədə olması və ya SMTP qəbul cavabı inbox-a çatdırılmanı təsdiqləmir.</p>
      <Link href="/admin/email" className="mt-3 inline-flex text-sm font-medium text-[#85621d]">Email növbəsinin vəziyyətinə bax →</Link>
    </header>
    <section className="grid gap-3 sm:grid-cols-2">
      <article className={card}><p className="text-sm text-slate-500">Təsdiqlənməmiş müştərilər</p><p className="mt-2 text-2xl font-semibold">{customerCount}</p></article>
      <article className={card}><p className="text-sm text-slate-500">Təsdiqlənməmiş satıcılar</p><p className="mt-2 text-2xl font-semibold">{vendorCount}</p></article>
    </section>
    <section className="mt-5 overflow-hidden rounded-2xl border border-[#e7e3d9] bg-white">
      <h2 className="border-b border-[#eeeae2] p-5 font-semibold">Ən əvvəl yaradılmış hesablar (maksimum 100)</h2>
      {accountRows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-[#f8f7f4] text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3 font-medium">Hesab</th><th className="px-4 py-3 font-medium">Rol</th><th className="px-4 py-3 font-medium">Qeydiyyat</th><th className="px-4 py-3 font-medium">Kod statusu</th><th className="px-4 py-3 font-medium">Əməl</th></tr></thead>
        <tbody className="divide-y divide-[#eeeae2]">{accountRows.map(user => <tr key={user.id}>
          <td className="px-4 py-3.5"><span className="font-medium">{user.name || user.email}</span><span className="block text-xs text-slate-500">{user.email}</span></td>
          <td className="px-4 py-3.5">{user.role === "customer" ? "Müştəri" : "Satıcı"}</td>
          <td className="px-4 py-3.5">{user.createdAt.toLocaleDateString("az-AZ")}</td>
          <td className="px-4 py-3.5">{user.emailVerification ? <><span>{user.emailVerification.expiresAt > new Date() ? "Etibarlı" : "Vaxtı bitib"}</span><span className="block text-xs text-slate-500">Cəhd: {user.emailVerification.attempts}/5 · Yenilənib {user.emailVerification.updatedAt.toLocaleString("az-AZ")}</span></> : <span className="text-amber-800">Təsdiq kodu qeydi yoxdur</span>}</td>
          <td className="px-4 py-3.5">{user.detailId ? <Link className="font-medium text-[#173c40] hover:underline" href={`/admin/${user.role === "customer" ? "customers" : "vendors"}/${user.detailId}`}>Hesaba bax</Link> : <span className="text-slate-500">Satıcı profili yoxdur</span>}</td>
        </tr>)}</tbody>
      </table></div> : <p className="p-5 text-sm text-slate-500">Təsdiq gözləyən aktiv hesab yoxdur.</p>}
      {(customerCount > 50 || vendorCount > 50) && <p className="border-t border-[#eeeae2] p-4 text-xs text-slate-500">Cədvəldə hər roldan ən çox 50 ən köhnə hesab göstərilir.</p>}
    </section>
  </AdminShell>;
}
