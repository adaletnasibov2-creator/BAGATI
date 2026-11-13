"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import AdminTwoFactorEnrollment from "@/components/admin-two-factor-enrollment";

type Props = {
  enrolled: boolean;
  enrolledAtLabel: string | null;
  remainingRecoveryCodes: number;
  required: boolean;
  keyConfigured: boolean;
};

const field = "rounded-xl border border-[#ded9cf] px-4 py-3 outline-none focus:border-[#bd9a5e]";

export default function AdminTwoFactorSettings({ enrolled, enrolledAtLabel, remainingRecoveryCodes, required, keyConfigured }: Props) {
  const router = useRouter();
  const [enrolling, setEnrolling] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function disable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm("İki mərhələli təsdiq söndürülsün? Digər bütün sessiyalar bağlanacaq.")) return;
    setBusy(true); setError(""); setMessage("");
    const values = new FormData(event.currentTarget);
    const factor = String(values.get("secondFactor") ?? "");
    try {
      const response = await fetch("/api/admin/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: values.get("password"), ...(useRecovery ? { recoveryCode: factor } : { code: factor }) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Əməliyyat alınmadı.");
      setMessage(data.message);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Əməliyyat alınmadı.");
    } finally {
      setBusy(false);
    }
  }

  if (!enrolled) {
    return <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <ShieldAlert size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
        <p>İki mərhələli təsdiq aktiv deyil. Şifrəniz oğurlansa belə, hesaba giriş üçün telefonunuzdakı kod da tələb olunsun.</p>
      </div>
      {!keyConfigured
        ? <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Aktivləşdirmə hazırda mümkün deyil: serverdə <code className="font-mono">BAGATI_ADMIN_2FA_KEY</code> konfiqurasiya edilməyib. Mövcud giriş qaydası dəyişmir.</p>
        : enrolling
          ? <AdminTwoFactorEnrollment mode="settings" onFinished={() => { setEnrolling(false); router.refresh(); }} />
          : <button type="button" onClick={() => setEnrolling(true)} className="rounded-xl bg-[#142d38] px-5 py-3 text-sm font-semibold text-white">İki mərhələli təsdiqi qoş</button>}
    </div>;
  }

  return <div className="space-y-4">
    <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <ShieldCheck size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
      <div>
        <p className="font-semibold">İki mərhələli təsdiq aktivdir</p>
        <p className="mt-1">{enrolledAtLabel ? `Qoşulub: ${enrolledAtLabel} (Bakı vaxtı). ` : ""}İstifadə olunmamış bərpa kodları: <b>{remainingRecoveryCodes}</b> / 10.</p>
      </div>
    </div>
    {remainingRecoveryCodes <= 3 && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Bərpa kodlarınız azalıb. Yeni kodlar üçün 2FA-nı söndürüb yenidən qoşun.</p>}
    {!keyConfigured && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">Server açarı (BAGATI_ADMIN_2FA_KEY) əlçatan deyil: autentifikator kodları yoxlanıla bilmir, girişdə bərpa kodundan istifadə edin.</p>}
    {required
      ? <p className="text-sm text-slate-600">İki mərhələli təsdiq bütün adminlər üçün məcburidir və söndürülə bilməz.</p>
      : <details className="rounded-xl border border-[#e7e3d9] p-4">
        <summary className="cursor-pointer text-sm font-semibold">İki mərhələli təsdiqi söndür</summary>
        <form onSubmit={disable} className="mt-4 grid max-w-xl gap-4">
          <label className="grid gap-1.5 text-sm font-medium">Cari şifrə<input className={field} type="password" name="password" autoComplete="current-password" required maxLength={128} /></label>
          <label className="grid gap-1.5 text-sm font-medium">{useRecovery ? "Bərpa kodu" : "Autentifikator kodu"}<input key={useRecovery ? "r" : "t"} className={`${field} font-mono tracking-widest`} name="secondFactor" inputMode={useRecovery ? "text" : "numeric"} autoComplete="one-time-code" maxLength={useRecovery ? 11 : 7} required /></label>
          <button type="button" onClick={() => setUseRecovery(!useRecovery)} className="w-fit text-sm font-medium text-[#9a701e]">{useRecovery ? "Autentifikator kodu istifadə et" : "Bərpa kodu istifadə et"}</button>
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
          <button disabled={busy} className="w-fit rounded-xl border border-red-300 bg-white px-5 py-3 text-sm font-semibold text-red-700 disabled:opacity-50">{busy ? "Yoxlanılır…" : "Söndür"}</button>
        </form>
      </details>}
  </div>;
}
