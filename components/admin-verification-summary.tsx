import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { cardClass, focusRing } from "@/components/admin-ui/styles";

/** Active accounts without a confirmed e-mail (ADMIN-POWER-1: also feeds the dashboard queue; read once per page). */
export async function loadUnverifiedCounts() {
  const [customers, vendors] = await Promise.all([
    prisma.user.count({ where: { role: "CUSTOMER", isActive: true, emailVerifiedAt: null } }),
    prisma.user.count({ where: { role: "VENDOR", isActive: true, emailVerifiedAt: null } }),
  ]);
  return { customers, vendors };
}

export default async function AdminVerificationSummary({ counts }: { counts?: { customers: number; vendors: number } } = {}) {
  const { customers, vendors } = counts ?? await loadUnverifiedCounts();

  // ADMIN-DESIGN-1: seller-panel card look (admin kit classes); same counts, links and text.
  return <section aria-labelledby="verification-summary-title" className={`mt-5 ${cardClass}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="verification-summary-title" className="text-h3 text-fg">Email təsdiqi gözləyən hesablar</h2><p className="mt-1 text-sm text-fg-secondary">Təsdiqlənməmiş aktiv hesablar; bu göstərici mesajın inbox-a çatmasını təsdiqləmir.</p></div>
      <Link href="/admin/verification" className={`rounded text-sm font-semibold text-primary hover:underline ${focusRing}`}>Siyahıya bax →</Link>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <Link href="/admin/verification" className={`rounded-control bg-surface-page p-4 transition-colors hover:bg-primary-subtle ${focusRing}`}><p className="text-sm text-fg-secondary">Müştərilər</p><p className="mt-1 text-2xl font-semibold tabular-nums text-fg">{customers}</p></Link>
      <Link href="/admin/verification" className={`rounded-control bg-surface-page p-4 transition-colors hover:bg-primary-subtle ${focusRing}`}><p className="text-sm text-fg-secondary">Satıcılar</p><p className="mt-1 text-2xl font-semibold tabular-nums text-fg">{vendors}</p></Link>
    </div>
  </section>;
}
