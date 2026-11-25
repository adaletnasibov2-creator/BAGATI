import Link from "next/link";
import { redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import { PageHeader } from "@/components/admin-ui/page-header";
import { buttonClass } from "@/components/admin-ui/styles";
import { adminMessagingNavEnabled } from "@/lib/messaging-pages";
import AdminTwoFactorSettings from "@/components/admin-two-factor-settings";
import { PasswordChangeForm } from "@/components/password-change-form";
import { requireRole } from "@/lib/auth";
import { twoFactorStatus } from "@/lib/admin-2fa";
import { formatBakuDateTime } from "@/lib/admin-audit-log";

export const dynamic = "force-dynamic";
const card = "rounded-card border border-line bg-white p-5";

export default async function AdminSecurityPage() {
  const admin = await requireRole("ADMIN");
  if (!admin) redirect("/admin/login");
  const status = await twoFactorStatus(admin.id);
  return <AdminShell email={admin.email} messagingEnabled={await adminMessagingNavEnabled()}>
    <PageHeader title="Hesab təhlükəsizliyi" description="Şifrə, iki mərhələli təsdiq və aktiv sessiyalar. Bütün dəyişikliklər audit jurnalında qeydə alınır." actions={<Link href="/admin/security/sessions" className={buttonClass("secondary")}>Aktiv sessiyalar →</Link>} />
    <div className="grid gap-5 xl:grid-cols-2">
      <section className={card}>
        <h2 className="font-semibold">İki mərhələli təsdiq (2FA)</h2>
        <p className="mt-1 text-sm text-fg-secondary">Girişdə şifrədən sonra autentifikator tətbiqindəki kod tələb olunur.</p>
        <div className="mt-4">
          <AdminTwoFactorSettings
            enrolled={status.enrolled}
            enrolledAtLabel={status.enrolledAt ? formatBakuDateTime(status.enrolledAt) : null}
            remainingRecoveryCodes={status.remainingRecoveryCodes}
            required={status.required}
            keyConfigured={status.keyStatus === "configured"}
          />
        </div>
      </section>
      <section className={card}>
        <h2 className="font-semibold">Şifrəni dəyiş</h2>
        <p className="mt-1 text-sm text-fg-secondary">Şifrəni dəyişməzdən əvvəl cari şifrənizi təsdiqləyin. Dəyişiklikdən sonra digər bütün sessiyalar bağlanır.</p>
        <PasswordChangeForm />
        <p className="mt-5 text-xs text-fg-secondary">Şifrə bərpa keçidi istəmək mümkündür; məktubun göndərilməsi worker və SMTP sazlamalarından asılıdır.</p>
      </section>
    </div>
  </AdminShell>;
}
