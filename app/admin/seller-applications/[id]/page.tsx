import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import { adminMessagingNavEnabled } from "@/lib/messaging-pages";
import AdminSellerApplicationReview from "@/components/admin-seller-application-review";
import StatusBadge from "@/components/seller-application-status-badge";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatBakuDateTime } from "@/lib/admin-audit-log";
import { AdminLegalAcceptances, adminLegalAcceptanceSelect } from "@/components/admin-legal-acceptances";
import { SELLER_APPLICATION_SOURCE_LABELS, SELLER_TYPE_LABELS } from "@/lib/seller-application";
import { findDuplicateVoen } from "@/lib/seller-application-service";
import { AdminVoenPanel } from "@/components/admin-voen-panel";
import { AdminDetailHeader } from "@/components/admin-ui/detail-header";
import { ADMIN_BACK_LINKS, adminRoleLabel } from "@/lib/admin-power-1";
import { adminVoenView, currentVoenOf } from "@/lib/voen-verification";

export const dynamic = "force-dynamic";

const card = "rounded-card border border-line bg-white p-5";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs text-fg-secondary">{label}</dt><dd className="mt-0.5 break-words text-sm text-fg">{children || "—"}</dd></div>;
}

export default async function AdminSellerApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) redirect("/admin/login");
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) notFound();
  const application = await prisma.vendorApplication.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, email: true, role: true, isActive: true, emailVerifiedAt: true, createdAt: true, legalAcceptances: { select: adminLegalAcceptanceSelect, orderBy: { acceptedAt: "desc" } } } },
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
  // The user's CURRENT VÖEN (seller profile, else this open application): the only one that can be verified.
  const voenView = await adminVoenView(prisma, application.userId, (await currentVoenOf(prisma, application.userId)) ?? application.voenNormalized ?? application.voen, formatBakuDateTime);
  const accountReady = application.user.role === "CUSTOMER" && application.user.isActive && Boolean(application.user.emailVerifiedAt);

  return <AdminShell email={admin.email} messagingEnabled={await adminMessagingNavEnabled()}>
    <AdminDetailHeader
      back={ADMIN_BACK_LINKS.sellerApplications}
      title={application.displayName}
      detail={<>Göndərilib: {formatBakuDateTime(application.createdAt)} · {SELLER_APPLICATION_SOURCE_LABELS[application.source]}</>}
      badge={<StatusBadge status={application.status} />}
      facts={[["E-poçt", application.user.email], ["Satıcı növü", application.sellerType ? SELLER_TYPE_LABELS[application.sellerType] : "—"]]}
    />

    {duplicateCount > 0 && <div role="alert" className="mb-4 rounded-card border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-semibold">Bu VÖEN başqa yerdə də istifadə olunur ({duplicateCount})</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {duplicates.profiles.map((row) => <li key={row.vendorProfileId} className="break-words">Satıcı profili: {row.displayName} · {row.email} · rol {adminRoleLabel(row.role)}</li>)}
        {duplicates.applications.map((row) => <li key={row.applicationId} className="break-words"><Link className="underline" href={`/admin/seller-applications/${row.applicationId}`}>Açıq müraciət: {row.displayName} · {row.email}</Link></li>)}
      </ul>
      <p className="mt-2">Eyni hüquqi şəxs bir neçə hesab aça bilər, lakin təsdiqdən əvvəl bunu yoxlayın. Təsdiq üçün ayrıca qəbul tələb olunur və audit jurnalında qeyd edilir.</p>
    </div>}

    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="grid min-w-0 content-start gap-4">
        <section className={card}>
          <h2 className="font-semibold text-fg">Satıcı məlumatları</h2>
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
          <h2 className="font-semibold text-fg">Müraciətçinin qeydi</h2>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-fg-body">{application.applicantNote || "Qeyd yoxdur."}</p>
          <p className="mt-2 text-xs text-fg-secondary">Yalnız adminlər görür.</p>
        </section>
        {application.status !== "PENDING" && <section className={card}>
          <h2 className="font-semibold text-fg">Qərar</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Qərar vaxtı">{application.reviewedAt ? formatBakuDateTime(application.reviewedAt) : application.withdrawnAt ? `Geri götürülüb: ${formatBakuDateTime(application.withdrawnAt)}` : null}</Field>
            <Field label="Admin">{application.reviewedBy?.email ?? (application.source === "LEGACY" ? "Köhnə satıcı (avtomatik)" : null)}</Field>
            {application.rejectionReason && <div className="sm:col-span-2"><Field label="Rədd səbəbi (müraciətçi görür)">{application.rejectionReason}</Field></div>}
            {application.adminNote && <div className="sm:col-span-2"><Field label="Daxili qeyd">{application.adminNote}</Field></div>}
            {application.duplicateVoenConfirmed && <div className="sm:col-span-2"><Field label="Təkrar VÖEN">Admin tərəfindən qəbul edilib</Field></div>}
          </dl>
          {/* ADMIN-3-ONBOARD-1: from an approved application straight to the seller (and from there to the store). */}
          {application.status === "APPROVED" && application.vendorProfileId && <p className="mt-4"><Link className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-2 hover:underline" href={`/admin/vendors/${encodeURIComponent(application.vendorProfileId)}`}>Satıcının səhifəsinə keç</Link></p>}
        </section>}
      </div>

      <div className="grid min-w-0 content-start gap-4">
        <section className={card}>
          <h2 className="font-semibold text-fg">Hesab</h2>
          <dl className="mt-3 grid gap-3">
            <Field label="E-poçt"><span className="break-all">{application.user.email}</span></Field>
            <Field label="Hazırkı rol">{adminRoleLabel(application.user.role)}</Field>
            <Field label="Hesab yaradılıb">{formatBakuDateTime(application.user.createdAt)}</Field>
            <Field label="E-poçt təsdiqi">{application.user.emailVerifiedAt ? "Təsdiqlənib" : "Təsdiqlənməyib"}</Field>
            <Field label="Aktivdir">{application.user.isActive ? "Bəli" : "Xeyr"}</Field>
          </dl>
        </section>
        <AdminLegalAcceptances rows={application.user.legalAcceptances} applicationId={application.id} className={card} />
        <AdminVoenPanel view={voenView} />
        {application.status === "PENDING" && <AdminSellerApplicationReview applicationId={application.id} duplicateCount={duplicateCount} accountReady={accountReady} />}
        {history.length > 0 && <section className={card}>
          <h2 className="font-semibold text-fg">Əvvəlki müraciətlər</h2>
          <ul className="mt-3 grid gap-2 text-sm">{history.map((row) => <li key={row.id} className="flex flex-wrap items-center gap-2">
            <Link className="text-primary underline-offset-2 hover:underline" href={`/admin/seller-applications/${row.id}`}>{formatBakuDateTime(row.createdAt)}</Link>
            <StatusBadge status={row.status} />
          </li>)}</ul>
        </section>}
      </div>
    </div>
  </AdminShell>;
}
