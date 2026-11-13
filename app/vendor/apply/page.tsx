import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import VendorApplyForm, { type VendorApplyDefaults } from "@/components/vendor-apply-form";
import VendorApplyWithdraw from "@/components/vendor-apply-withdraw";
import StatusBadge from "@/components/seller-application-status-badge";
import { formatBakuDateTime } from "@/lib/admin-audit-log";
import { SELLER_TYPE_LABELS } from "@/lib/seller-application";
import { applicantState } from "@/lib/seller-application-service";

export const dynamic = "force-dynamic";

const card = "mt-6 rounded-2xl border border-[#e8e4db] bg-white p-5 sm:p-7";

function Summary({ items }: { items: [string, string | null | undefined][] }) {
  return <dl className="mt-4 grid gap-3 sm:grid-cols-2">{items.map(([title, value]) => <div key={title} className="min-w-0">
    <dt className="text-xs text-slate-500">{title}</dt>
    <dd className="mt-0.5 break-words text-sm text-slate-900">{value || "—"}</dd>
  </div>)}</dl>;
}

export default async function VendorApplyPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=%2Fvendor%2Fapply");
  if (user.role === "VENDOR") redirect("/vendor");
  if (user.role !== "CUSTOMER") redirect("/");
  const [profile, state] = await Promise.all([
    prisma.customerProfile.findUnique({ where: { userId: user.id }, select: { firstName: true, lastName: true, phone: true } }),
    applicantState(prisma, user.id),
  ]);
  const { latest, decision } = state;
  const previous = latest && latest.status !== "PENDING" ? latest : null;
  const defaults: VendorApplyDefaults = {
    displayName: previous?.displayName ?? [profile?.firstName, profile?.lastName].filter(Boolean).join(" "),
    phone: previous?.phone ?? profile?.phone ?? "",
    sellerType: previous?.sellerType ?? "INDIVIDUAL_ENTREPRENEUR",
    legalName: previous?.legalName ?? "",
    voen: previous?.voen ?? "",
    legalAddress: previous?.legalAddress ?? "",
    plannedStoreName: previous?.plannedStoreName ?? "",
  };
  const waitUntil = !decision.allowed && "nextAllowedAt" in decision ? decision.nextAllowedAt : null;

  return <main className="container max-w-2xl py-10 sm:py-14">
    <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#967844]">Satıcı müraciəti</p>
    <h1 className="mt-2 text-3xl font-semibold text-[#142d38]">BAGATI-da satıcı olun</h1>
    <p className="mt-3 text-sm leading-6 text-slate-600">Müraciətinizi BAGATI admini yoxlayır. Təsdiqə qədər hesabınız müştəri hesabı olaraq qalır; təsdiqdən sonra satıcı hesabına çevrilir. Sifariş tarixçəniz silinmir, lakin satıcı hesabında müştəri funksiyaları məhdudlaşa bilər.</p>

    {latest?.status === "PENDING" && <section className={card} aria-labelledby="application-status">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="application-status" className="text-lg font-semibold text-[#142d38]">Müraciətiniz yoxlanılır</h2>
        <StatusBadge status="PENDING" />
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-600">Göndərilib: {formatBakuDateTime(latest.createdAt)} (Bakı vaxtı). Qərar verildikdə bu səhifədə görünəcək; e-poçt bildirişi də göndəriləcək.</p>
      <Summary items={[
        ["Satıcı / şirkət adı", latest.displayName],
        ["Satıcı növü", latest.sellerType ? SELLER_TYPE_LABELS[latest.sellerType] : null],
        ["Hüquqi ad", latest.legalName],
        ["VÖEN", latest.voen],
        ["Telefon", latest.phone],
        ["Planlaşdırılan mağaza", latest.plannedStoreName],
      ]} />
      <VendorApplyWithdraw applicationId={latest.id} />
    </section>}

    {latest?.status === "REJECTED" && <section className={card} aria-labelledby="application-rejected">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="application-rejected" className="text-lg font-semibold text-[#142d38]">Əvvəlki müraciətiniz rədd edildi</h2>
        <StatusBadge status="REJECTED" />
      </div>
      <p className="mt-3 text-sm font-medium text-slate-800">Səbəb:</p>
      <p className="mt-1 whitespace-pre-wrap break-words rounded-xl bg-[#f8f7f4] p-3 text-sm text-slate-700">{latest.rejectionReason}</p>
      {latest.reviewedAt && <p className="mt-2 text-xs text-slate-500">Qərar: {formatBakuDateTime(latest.reviewedAt)} (Bakı vaxtı)</p>}
    </section>}

    {latest?.status === "WITHDRAWN" && <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[#142d38]">Müraciətinizi geri götürdünüz</h2>
        <StatusBadge status="WITHDRAWN" />
      </div>
      {latest.withdrawnAt && <p className="mt-2 text-sm text-slate-600">{formatBakuDateTime(latest.withdrawnAt)} (Bakı vaxtı)</p>}
    </section>}

    {latest?.status === "APPROVED" && <section className={card}>
      <h2 className="text-lg font-semibold text-[#142d38]">Müraciətiniz təsdiqlənib</h2>
      <p className="mt-2 text-sm text-slate-600">Hesabınız yenilənir. Səhifəni bir az sonra yeniləyin və ya <Link className="underline" href="/vendor">satıcı panelini</Link> açın.</p>
    </section>}

    {latest?.status !== "PENDING" && latest?.status !== "APPROVED" && (decision.allowed
      ? <VendorApplyForm defaults={defaults} />
      : waitUntil && <section className={card} role="status">
        <h2 className="text-lg font-semibold text-[#142d38]">Yeni müraciət</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {decision.reason === "LIMIT" ? "Son 30 gündə 3 müraciət göndərmisiniz." : "Rədd edilmiş və ya geri götürülmüş müraciətdən sonra 24 saat gözləmək lazımdır."}
          {" "}Yeni müraciəti <strong>{formatBakuDateTime(waitUntil)}</strong> (Bakı vaxtı) tarixindən sonra göndərə bilərsiniz.
        </p>
      </section>)}
  </main>;
}
