"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { TextLink } from "@/components/ui/text-link";

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
        body: JSON.stringify(role === "CUSTOMER" ? { code, next: nextPath } : { code }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Təsdiq alınmadı.");
      // SIGNUP-EASY-1 R2: a customer is signed in by the server; go to the server-sanitized destination. Sellers (and a
      // customer whose session could not be created) continue to the login page as before.
      if (data.signedIn === true && typeof data.redirectTo === "string" && data.redirectTo.startsWith("/") && !data.redirectTo.startsWith("//") && !data.redirectTo.includes("\\")) {
        window.location.replace(data.redirectTo);
        return;
      }
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
            {/* DESIGN-T9: shared field and buttons (visible focus ring); requests and texts unchanged. */}
            <Input
              id="verify-code"
              label="6 rəqəmli təsdiq kodu"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              controlClassName="text-center text-xl tracking-[.4em]"
            />
            <p className="text-sm text-fg-secondary">Kod yaradıldığı vaxtdan 10 dəqiqə ərzində qüvvədədir.</p>
            {error && <p role="alert" className="rounded-control bg-danger-subtle px-4 py-3 text-sm font-medium text-danger">{error}</p>}
            {message && <p role="status" className="rounded-control bg-primary-tint px-4 py-3 text-sm text-primary">{message}</p>}
            <Button type="submit" size="lg" fullWidth disabled={busy || code.length !== 6} loading={busy} loadingLabel="Yoxlanılır…">Təsdiqlə</Button>
          </form>
          <Button variant="secondary" fullWidth onClick={resend} loading={resending} loadingLabel="Sorğu göndərilir…" className="mt-4">Yeni kod istə</Button>
        </>
      ) : (
        <div className="rounded-control bg-surface-page p-5 text-sm leading-6 text-fg-secondary">
          Təsdiq sessiyası mövcud deyil və ya vaxtı bitib. Qeydiyyat və ya giriş səhifəsindən yenidən davam edin.
        </div>
      )}
      <TextLink href={loginPath} underline={false} className="mx-auto mt-3 flex min-h-11 w-fit items-center text-sm">Giriş səhifəsinə qayıt</TextLink>
    </div>
  );
}
