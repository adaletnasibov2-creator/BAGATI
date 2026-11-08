"use client";

import { FormEvent, useState } from "react";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Sorğunu emal etmək mümkün olmadı.");
      setMessage(data.message || "Sorğu qəbul edildi.");
    } catch (reason) {
      setError(reason instanceof TypeError ? "Bağlantı xətası. Yenidən cəhd edin." : reason instanceof Error ? reason.message : "Sorğunu emal etmək mümkün olmadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-7 space-y-4">
      <label className="block text-sm font-medium text-[#0B1726]">
        Hesab e-poçtu
        <input
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1.5 w-full rounded-xl border border-[#E1DED4] bg-white px-4 py-3 outline-none focus:border-[#D9A441]"
        />
      </label>
      <p className="text-sm leading-6 text-[#667085]">Google ilə yaradılmış hesablar üçün Google ilə daxil olun; bu formada onlar üçün şifrə bərpa məktubu göndərilmir.</p>
      {message && <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm text-green-800">{message}</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={busy} className="w-full rounded-full bg-[#0B1726] px-5 py-3.5 font-medium text-white disabled:opacity-50">
        {busy ? "Göndərilir…" : "Bərpa keçidi istə"}
      </button>
    </form>
  );
}
