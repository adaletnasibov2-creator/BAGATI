import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import AdminSellerApplicationReview from "@/components/admin-seller-application-review";
import StatusBadge from "@/components/seller-application-status-badge";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatBakuDateTime } from "@/lib/admin-audit-log";
import { SELLER_APPLICATION_SOURCE_LABELS, SELLER_TYPE_LABELS } from "@/lib/seller-application";
import { findDuplicateVoen } from "@/lib/seller-application-service";

export const dynamic = "force-dynamic";

const card = "rounded-2xl border border-[#e7e3d9] bg-white p-5";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-0.5 break-words text-sm text-slate-900">{children || "—"}</dd></div>;
}

export default async function AdminSellerApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) redirect("/admin/login");
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) notFound();
  const application = await prisma.vendorApplication.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, email: true, role: true, isActive: true, emailVerifiedAt: true, createdAt: true } },
      reviewedBy: { select: { email: true } },
    },
  });
  if (!application) notFound();
  const [history, duplicates] = await Promise.all([
    prisma.vendorApplication.findMany({
      where: { userId: application.userId, id: { not: application.id } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, status: true, createdAt: true, rejectionReason: true },
    }),
    findDuplicateVoen(prisma, { applicationId: application.id, userId: application.userId, voenNormalized: application.voenNormalized }),
  ]);
  const duplicateCount = duplicates.profiles.length + duplicates.applications.length;
  const accountReady = application.user.role === "CUSTOMER" && application.user.isActive && Boolean(application.user.emailVerifiedAt);

  return <AdminShell email={admin.email}>
    <Link href="/admin/seller-applications" className="text-sm text-[#173c40] underline-offset-2 hover:underline">← Satıcı müraciətləri</Link>
    <div className="mb-6 mt-3 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-[#9b7840]">BAGATI · ADMIN</p>
        <h1 className="mt-2 break-words text-3xl font-semibold text-[#0d1b2a]">{application.displayName}</h1>
        <p className="mt-2 text-sm text-slate-500">Göndərilib: {formatBakuDateTime(application.createdAt)} · {SELLER_APPLICATION_SOURCE_LABELS[application.source]}</p>
      </div>
      <StatusBadge status={application.status} />
    </div>

    {duplicateCount > 0 && <div role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-semibold">Bu VÖEN başqa yerdə də istifadə olunur ({duplicateCount})</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {duplicates.profiles.map((row) => <li key={row.vendorProfileId} className="break-words">Satıcı profili: {row.displayName} · {row.email} · rol {row.role}</li>)}
        {duplicates.applications.map((row) => <li key={row.applicationId} className="break-words"><Link className="underline" href={`/admin/seller-applications/${row.applicationId}`}>Açıq müraciət: {row.displayName} · {row.email}</Link></li>)}
      </ul>
      <p className="mt-2">Eyni hüquqi şəxs bir neçə hesab aça bilər, lakin təsdiqdən əvvəl bunu yoxlayın. Təsdiq üçün ayrıca qəbul tələb olunur və audit jurnalında qeyd edilir.</p>
    </div>}

    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="grid min-w-0 content-start gap-4">
        <section className={card}>
          <h2 className="font-semibold text-[#0d1b2a]">Satıcı məlumatları</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Satıcı / mağaza adı">{application.displayName}</Field>
            <Field label="Planlaşdırılan mağaza adı">{application.plannedStoreName}</Field>
            <Field label="Satıcı növü">{application.sellerType ? SELLER_TYPE_LABELS[application.sellerType] : null}</Field>
            <Field label="Telefon">{application.phone}</Field>
            <Field label="Hüquqi ad">{application.legalName}</Field>
            <Field label="VÖEN"><span className="font-mono">{application.voen}</span></Field>
            <div className="sm:col-span-2"><Field label="Hüquqi ünvan">{application.legalAddress}</Field></div>
          </dl>
        </section>
        <section className={card}>
          <h2 className="font-semibold text-[#0d1b2a]">Müraciətçinin qeydi</h2>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{application.applicantNote || "Qeyd yoxdur."}</p>
          <p className="mt-2 text-xs text-slate-500">Yalnız adminlər görür.</p>
        </section>
        {application.status !== "PENDING" && <section className={card}>
          <h2 className="font-semibold text-[#0d1b2a]">Qərar</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Qərar vaxtı">{application.reviewedAt ? formatBakuDateTime(application.reviewedAt) : application.withdrawnAt ? `Geri götürülüb: ${formatBakuDateTime(application.withdrawnAt)}` : null}</Field>
            <Field label="Admin">{application.reviewedBy?.email ?? (application.source === "LEGACY" ? "Köhnə satıcı (avtomatik)" : null)}</Field>
            {application.rejectionReason && <div className="sm:col-span-2"><Field label="Rədd səbəbi (müraciətçi görür)">{application.rejectionReason}</Field></div>}
            {application.adminNote && <div className="sm:col-span-2"><Field label="Daxili qeyd">{application.adminNote}</Field></div>}
            {application.duplicateVoenConfirmed && <div className="sm:col-span-2"><Field label="Təkrar VÖEN">Admin tərəfindən qəbul edilib</Field></div>}
          </dl>
        </section>}
      </div>

      <div className="grid min-w-0 content-start gap-4">
        <section className={card}>
          <h2 className="font-semibold text-[#0d1b2a]">Hesab</h2>
          <dl className="mt-3 grid gap-3">
            <Field label="E-poçt"><span className="break-all">{application.user.email}</span></Field>
            <Field label="Hazırkı rol">{application.user.role}</Field>
            <Field label="Hesab yaradılıb">{formatBakuDateTime(application.user.createdAt)}</Field>
            <Field label="E-poçt təsdiqi">{application.user.emailVerifiedAt ? "Təsdiqlənib" : "Təsdiqlənməyib"}</Field>
            <Field label="Aktivdir">{application.user.isActive ? "Bəli" : "Xeyr"}</Field>
          </dl>
        </section>
        {application.status === "PENDING" && <AdminSellerApplicationReview applicationId={application.id} duplicateCount={duplicateCount} accountReady={accountReady} />}
        {history.length > 0 && <section className={card}>
          <h2 className="font-semibold text-[#0d1b2a]">Əvvəlki müraciətlər</h2>
          <ul className="mt-3 grid gap-2 text-sm">{history.map((row) => <li key={row.id} className="flex flex-wrap items-center gap-2">
            <Link className="text-[#173c40] underline-offset-2 hover:underline" href={`/admin/seller-applications/${row.id}`}>{formatBakuDateTime(row.createdAt)}</Link>
            <StatusBadge status={row.status} />
          </li>)}</ul>
        </section>}
      </div>
    </div>
  </AdminShell>;
}
