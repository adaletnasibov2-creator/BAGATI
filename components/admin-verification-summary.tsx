import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function AdminVerificationSummary() {
  const [customers, vendors] = await Promise.all([
    prisma.user.count({ where: { role: "CUSTOMER", isActive: true, emailVerifiedAt: null } }),
    prisma.user.count({ where: { role: "VENDOR", isActive: true, emailVerifiedAt: null } }),
  ]);

  return <section aria-labelledby="verification-summary-title" className="mt-5 rounded-2xl border border-[#e7e3d9] bg-white p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="verification-summary-title" className="font-semibold">Email təsdiqi gözləyən hesablar</h2><p className="mt-1 text-sm text-slate-500">Təsdiqlənməmiş aktiv hesablar; bu göstərici mesajın inbox-a çatmasını təsdiqləmir.</p></div>
      <Link href="/admin/verification" className="text-sm font-medium text-[#85621d]">Siyahıya bax →</Link>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <Link href="/admin/verification" className="rounded-xl bg-[#f8f7f4] p-4 transition hover:bg-[#f1eee6]"><p className="text-sm text-slate-500">Müştərilər</p><p className="mt-1 text-2xl font-semibold text-[#142d38]">{customers}</p></Link>
      <Link href="/admin/verification" className="rounded-xl bg-[#f8f7f4] p-4 transition hover:bg-[#f1eee6]"><p className="text-sm text-slate-500">Satıcılar</p><p className="mt-1 text-2xl font-semibold text-[#142d38]">{vendors}</p></Link>
    </div>
  </section>;
}
