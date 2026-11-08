"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

type VerificationRole = "CUSTOMER" | "VENDOR";

export function EmailVerificationForm({
  role,
  hasContext,
  deliveryFailed = false,
  fromLogin = false,
  nextPath = "/account",
}: {
  role: VerificationRole;
  hasContext: boolean;
  deliveryFailed?: boolean;
  fromLogin?: boolean;
  nextPath?: string;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(deliveryFailed ? "Əvvəlki məktubun çatdırılması təsdiqlənmədi. Yeni kodu növbəyə əlavə edə bilərsiniz." : "");
  const [message, setMessage] = useState(
    fromLogin
      ? "Bu hesab hələ təsdiqlənməyib. Adi giriş kod göndərmir. Yeni kodu aşağıdakı düymə ilə ayrıca istəyin."
      : hasContext && !deliveryFailed
        ? "Sorğu qəbul edildi. Əgər yeni hesab yaradılıbsa, təsdiq kodu e-poçt ünvanına göndərilmə növbəsindədir; çatdırılma e-poçt xidmətinin qəbulundan asılıdır."
        : "",
  );
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const loginPath = role === "VENDOR" ? "/vendor/login" : `/login?next=${encodeURIComponent(nextPath)}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Təsdiq alınmadı.");
      window.location.replace(`${loginPath}${loginPath.includes("?") ? "&" : "?"}verified=1`);
    } catch (reason) {
      setError(reason instanceof TypeError ? "Bağlantı xətası. Yenidən cəhd edin." : reason instanceof Error ? reason.message : "Təsdiq alınmadı.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setResending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/auth/resend-verification", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Yeni kod istəyi qəbul edilmədi.");
      setMessage("Sorğu qəbul edildi. Əgər hesab təsdiq gözləyirsə və göndərmə limiti imkan verirsə, kod növbəyə əlavə oluna bilər.");
    } catch (reason) {
      setError(reason instanceof TypeError ? "Bağlantı xətası. Yenidən cəhd edin." : reason instanceof Error ? reason.message : "Yeni kod göndərilmədi.");
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="mt-8">
      {hasContext ? (
        <>
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm font-medium text-[#16202C]">
              6 rəqəmli təsdiq kodu
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                className="mt-1.5 w-full rounded-xl border border-[#E1DED4] bg-white px-4 py-3 text-center text-xl tracking-[.4em] outline-none focus:border-[#D9A441]"
              />
            </label>
            <p className="text-sm text-[#667085]">Kod yaradıldığı vaxtdan 10 dəqiqə ərzində qüvvədədir.</p>
            {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
            {message && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</p>}
            <button disabled={busy || code.length !== 6} className="w-full rounded-full bg-[#0B1726] px-5 py-3.5 font-medium text-white disabled:opacity-50">
              {busy ? "Yoxlanılır…" : "Təsdiqlə"}
            </button>
          </form>
          <button
            type="button"
            onClick={resend}
            disabled={resending}
            className="mt-4 w-full rounded-full border border-[#D8D2C5] px-5 py-3 text-sm font-medium text-[#72541F] disabled:opacity-50"
          >
            {resending ? "Sorğu göndərilir…" : "Yeni kod istə"}
          </button>
        </>
      ) : (
        <div className="rounded-2xl bg-[#F7F5EF] p-5 text-sm leading-6 text-[#667085]">
          Təsdiq sessiyası mövcud deyil və ya vaxtı bitib. Qeydiyyat və ya giriş səhifəsindən yenidən davam edin.
        </div>
      )}
      <Link href={loginPath} className="mt-5 block text-center text-sm font-medium text-[#85621d]">Giriş səhifəsinə qayıt</Link>
    </div>
  );
}
