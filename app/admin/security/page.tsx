import Link from "next/link";
import { redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import AdminTwoFactorSettings from "@/components/admin-two-factor-settings";
import { PasswordChangeForm } from "@/components/password-change-form";
import { requireRole } from "@/lib/auth";
import { twoFactorStatus } from "@/lib/admin-2fa";
import { formatBakuDateTime } from "@/lib/admin-audit-log";

export const dynamic = "force-dynamic";
const card = "rounded-2xl border border-[#e7e3d9] bg-white p-5";

export default async function AdminSecurityPage() {
  const admin = await requireRole("ADMIN");
  if (!admin) redirect("/admin/login");
  const status = await twoFactorStatus(admin.id);
  return <AdminShell email={admin.email}>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-[#9b7840]">BAGATI · ADMIN</p>
        <h1 className="mt-2 text-3xl font-semibold text-[#0d1b2a]">Hesab təhlükəsizliyi</h1>
        <p className="mt-2 text-sm text-slate-500">Şifrə, iki mərhələli təsdiq və aktiv sessiyalar. Bütün dəyişikliklər audit jurnalında qeydə alınır.</p>
      </div>
      <Link href="/admin/security/sessions" className="rounded-xl border border-[#c7ad78] bg-white px-4 py-2.5 text-sm font-semibold text-[#85621d]">Aktiv sessiyalar →</Link>
    </div>
    <div className="grid gap-5 xl:grid-cols-2">
      <section className={card}>
        <h2 className="font-semibold">İki mərhələli təsdiq (2FA)</h2>
        <p className="mt-1 text-sm text-slate-500">Girişdə şifrədən sonra autentifikator tətbiqindəki kod tələb olunur.</p>
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
        <p className="mt-1 text-sm text-slate-600">Şifrəni dəyişməzdən əvvəl cari şifrənizi təsdiqləyin. Dəyişiklikdən sonra digər bütün sessiyalar bağlanır.</p>
        <PasswordChangeForm />
        <p className="mt-5 text-xs text-slate-500">Şifrə bərpa keçidi istəmək mümkündür; məktubun göndərilməsi worker və SMTP sazlamalarından asılıdır.</p>
      </section>
    </div>
  </AdminShell>;
}
