import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Clock3 } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import VendorApplyForm, { type VendorApplyDefaults } from "@/components/vendor-apply-form";
import VendorApplyWithdraw from "@/components/vendor-apply-withdraw";
import { Badge } from "@/components/ui/badge";
import { formatBakuDateTime } from "@/lib/admin-audit-log";
import { reapplyRulesFrom, SELLER_APPLICATION_STATUS_LABELS, SELLER_TYPE_LABELS, sellerApplicationLimitTexts, type SellerApplicationStatus } from "@/lib/seller-application";
import { loadSellerApplicationLimits } from "@/lib/settings/limits";
import { applicantState } from "@/lib/seller-application-service";
import { sellerApplicationTone } from "@/lib/vendor-status-tone";

export const dynamic = "force-dynamic";

// DESIGN-T8: the site header, footer and public theme come from app/vendor/apply/layout.tsx (the customer layout).
const card = "rounded-card border border-line bg-white p-5 shadow-subtle sm:p-6";

function StatusBadge({ status }: { status: SellerApplicationStatus }) {
  return <Badge tone={sellerApplicationTone(status)} size="md" className="whitespace-nowrap">{SELLER_APPLICATION_STATUS_LABELS[status]}</Badge>;
}

function StatusHeader({ id, title, status }: { id?: string; title: string; status?: SellerApplicationStatus }) {
  return <div className="flex flex-wrap items-center justify-between gap-3">
    <h2 id={id} className="font-display text-h3 text-fg">{title}</h2>
    {status && <StatusBadge status={status} />}
  </div>;
}

function Summary({ items }: { items: [string, string | null | undefined][] }) {
  return <dl className="mt-5 grid gap-x-6 gap-y-4 rounded-control bg-surface-page p-4 sm:grid-cols-2">{items.map(([title, value]) => <div key={title} className="min-w-0">
    <dt className="text-xs font-medium text-fg-muted">{title}</dt>
    <dd className="mt-0.5 break-words text-sm text-fg">{value || "—"}</dd>
  </div>)}</dl>;
}

/** From 1024 px: the steps the page already describes (form text), as a calm side card. No new claims. */
function HowItWorks() {
  const steps = [
    "Müraciət göndərildikdən sonra admin məlumatları yoxlayır.",
    "Təsdiqə qədər hesabınız müştəri hesabı olaraq qalır.",
    "Təsdiqdən sonra satıcı panelində mağaza qaralaması yarada bilərsiniz; mağaza ictimai satış üçün ayrıca yoxlanılır.",
  ];
  return <aside aria-labelledby="vendor-apply-how" data-vendor-apply-how="" className="hidden rounded-card border border-line bg-surface-page p-5 lg:block">
    <h2 id="vendor-apply-how" className="font-display text-h3 text-fg">Müraciət necə işləyir</h2>
    <ol className="mt-4 grid gap-4">{steps.map((step, index) => <li key={step} className="flex gap-3 text-sm leading-6 text-fg-secondary">
      <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary-tint text-xs font-semibold text-primary">{index + 1}</span>
      <span>{step}</span>
    </li>)}</ol>
  </aside>;
}

export default async function VendorApplyPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=%2Fvendor%2Fapply");
  if (user.role === "VENDOR") redirect("/vendor");
  if (user.role !== "CUSTOMER") redirect("/");
  // Wait and count come from the settings engine (defaults 24 hours and 3 per 30 days); texts are built from them.
  const limits = await loadSellerApplicationLimits();
  const texts = sellerApplicationLimitTexts(limits);
  const [profile, state] = await Promise.all([
    prisma.customerProfile.findUnique({ where: { userId: user.id }, select: { firstName: true, lastName: true, phone: true } }),
    applicantState(prisma, user.id, new Date(), reapplyRulesFrom(limits)),
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

  return <div className="container py-8 md:py-12">
    <header className="max-w-3xl">
      <p className="text-kicker uppercase text-gold-700">Satıcı müraciəti</p>
      <h1 className="mt-2 font-display text-h1 text-fg">BAGATI-da satıcı olun</h1>
      <p className="mt-3 text-body text-fg-secondary">Müraciətinizi BAGATI admini yoxlayır. Təsdiqə qədər hesabınız müştəri hesabı olaraq qalır; təsdiqdən sonra satıcı hesabına çevrilir. Sifariş tarixçəniz silinmir, lakin satıcı hesabında müştəri funksiyaları məhdudlaşa bilər.</p>
    </header>

    <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-8">
      <div data-vendor-apply-main="" className="grid min-w-0 gap-5">
        {latest?.status === "PENDING" && <section className={card} aria-labelledby="application-status">
          <StatusHeader id="application-status" title="Müraciətiniz yoxlanılır" status="PENDING" />
          <p className="mt-2 text-sm leading-6 text-fg-secondary">Göndərilib: {formatBakuDateTime(latest.createdAt)} (Bakı vaxtı). Qərar verildikdə bu səhifədə görünəcək; e-poçt bildirişi də göndəriləcək.</p>
          <Summary items={[
            ["Satıcı / şirkət adı", latest.displayName],
            ["Satıcı növü", latest.sellerType ? SELLER_TYPE_LABELS[latest.sellerType] : null],
            ["Hüquqi ad", latest.legalName],
            ["VÖEN", latest.voen],
            ["Telefon", latest.phone],
            ["Planlaşdırılan mağaza", latest.plannedStoreName],
          ]} />
          <VendorApplyWithdraw applicationId={latest.id} confirmText={texts.withdrawConfirm} />
        </section>}

        {latest?.status === "REJECTED" && <section className={card} aria-labelledby="application-rejected">
          <StatusHeader id="application-rejected" title="Əvvəlki müraciətiniz rədd edildi" status="REJECTED" />
          <p className="mt-4 text-sm font-medium text-fg">Səbəb:</p>
          <p className="mt-1 whitespace-pre-wrap break-words rounded-control border-l-4 border-danger bg-danger-subtle p-3 text-sm text-fg-body">{latest.rejectionReason}</p>
          {latest.reviewedAt && <p className="mt-2 text-xs text-fg-muted">Qərar: {formatBakuDateTime(latest.reviewedAt)} (Bakı vaxtı)</p>}
        </section>}

        {latest?.status === "WITHDRAWN" && <section className={card}>
          <StatusHeader title="Müraciətinizi geri götürdünüz" status="WITHDRAWN" />
          {latest.withdrawnAt && <p className="mt-2 text-sm text-fg-secondary">{formatBakuDateTime(latest.withdrawnAt)} (Bakı vaxtı)</p>}
        </section>}

        {latest?.status === "APPROVED" && <section className={`${card} text-center`}>
          <span aria-hidden="true" className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary-subtle text-primary ring-1 ring-inset ring-brand-100"><CheckCircle2 size={26}/></span>
          <h2 className="mt-4 font-display text-h3 text-fg">Müraciətiniz təsdiqlənib</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-fg-secondary">Hesabınız yenilənir. Səhifəni bir az sonra yeniləyin və ya <Link className="font-medium text-primary underline underline-offset-2" href="/vendor">satıcı panelini</Link> açın.</p>
          <div className="mt-5 flex justify-center"><StatusBadge status="APPROVED" /></div>
        </section>}

        {latest?.status !== "PENDING" && latest?.status !== "APPROVED" && (decision.allowed
          ? <VendorApplyForm defaults={defaults} />
          : waitUntil && <section className={card} role="status">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gold-100 text-gold-700 ring-1 ring-inset ring-gold-200"><Clock3 size={20}/></span>
              <div className="min-w-0">
                <h2 className="font-display text-h3 text-fg">Yeni müraciət</h2>
                <p className="mt-2 text-sm leading-6 text-fg-secondary">
                  {decision.reason === "LIMIT" ? texts.limitReached : texts.waitRule}
                  {" "}Yeni müraciəti <strong className="font-semibold text-fg">{formatBakuDateTime(waitUntil)}</strong> (Bakı vaxtı) tarixindən sonra göndərə bilərsiniz.
                </p>
              </div>
            </div>
          </section>)}

      </div>
      <HowItWorks />
    </div>
  </div>;
}
