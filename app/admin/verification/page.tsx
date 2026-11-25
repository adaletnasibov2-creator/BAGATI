import Link from "next/link";
import { redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import { PageHeader } from "@/components/admin-ui/page-header";
import { buttonClass } from "@/components/admin-ui/styles";
import { adminMessagingNavEnabled } from "@/lib/messaging-pages";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const card = "rounded-card border border-line bg-white p-5";

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

  return <AdminShell email={admin.email} messagingEnabled={await adminMessagingNavEnabled()}>
    <PageHeader title="Email təsdiqi gözləyən hesablar" description="Bu siyahı aktiv, təsdiqlənməmiş müştəri və satıcı hesablarını göstərir. Kodun növbədə olması və ya SMTP qəbul cavabı inbox-a çatdırılmanı təsdiqləmir." actions={<Link href="/admin/email" className={buttonClass("secondary")}>Email növbəsinin vəziyyətinə bax →</Link>} />
    <section className="grid gap-3 sm:grid-cols-2">
      <article className={card}><p className="text-sm text-fg-secondary">Təsdiqlənməmiş müştərilər</p><p className="mt-2 text-2xl font-semibold">{customerCount}</p></article>
      <article className={card}><p className="text-sm text-fg-secondary">Təsdiqlənməmiş satıcılar</p><p className="mt-2 text-2xl font-semibold">{vendorCount}</p></article>
    </section>
    <section className="mt-5 overflow-hidden rounded-card border border-line bg-white">
      <h2 className="border-b border-line p-5 font-semibold">Ən əvvəl yaradılmış hesablar (maksimum 100)</h2>
      {accountRows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-surface-page text-xs uppercase tracking-wide text-fg-secondary"><tr><th className="px-4 py-3 font-medium">Hesab</th><th className="px-4 py-3 font-medium">Rol</th><th className="px-4 py-3 font-medium">Qeydiyyat</th><th className="px-4 py-3 font-medium">Kod statusu</th><th className="px-4 py-3 font-medium">Əməl</th></tr></thead>
        <tbody className="divide-y divide-line">{accountRows.map(user => <tr key={user.id}>
          <td className="px-4 py-3.5"><span className="font-medium">{user.name || user.email}</span><span className="block text-xs text-fg-secondary">{user.email}</span></td>
          <td className="px-4 py-3.5">{user.role === "customer" ? "Müştəri" : "Satıcı"}</td>
          <td className="px-4 py-3.5">{user.createdAt.toLocaleDateString("az-AZ")}</td>
          <td className="px-4 py-3.5">{user.emailVerification ? <><span>{user.emailVerification.expiresAt > new Date() ? "Etibarlı" : "Vaxtı bitib"}</span><span className="block text-xs text-fg-secondary">Cəhd: {user.emailVerification.attempts}/5 · Yenilənib {user.emailVerification.updatedAt.toLocaleString("az-AZ")}</span></> : <span className="text-amber-800">Təsdiq kodu qeydi yoxdur</span>}</td>
          <td className="px-4 py-3.5">{user.detailId ? <Link className="font-medium text-primary hover:underline" href={`/admin/${user.role === "customer" ? "customers" : "vendors"}/${user.detailId}`}>Hesaba bax</Link> : <span className="text-fg-secondary">Satıcı profili yoxdur</span>}</td>
        </tr>)}</tbody>
      </table></div> : <p className="p-5 text-sm text-fg-secondary">Təsdiq gözləyən aktiv hesab yoxdur.</p>}
      {(customerCount > 50 || vendorCount > 50) && <p className="border-t border-line p-4 text-xs text-fg-secondary">Cədvəldə hər roldan ən çox 50 ən köhnə hesab göstərilir.</p>}
    </section>
  </AdminShell>;
}
