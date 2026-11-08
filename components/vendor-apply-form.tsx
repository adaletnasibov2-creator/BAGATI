"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const field = "mt-1 w-full rounded-xl border border-[#ded9cf] bg-white px-3.5 py-3 text-sm";

export default function VendorApplyForm({ displayName, phone }: { displayName: string; phone: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const response = await fetch("/api/vendor/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Müraciəti göndərmək mümkün olmadı.");
      router.replace("/vendor/stores/new"); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Müraciəti göndərmək mümkün olmadı."); setBusy(false); }
  }
  return <form onSubmit={submit} className="mt-6 grid gap-4 rounded-2xl border border-[#e8e4db] bg-white p-5 sm:p-7">
    <label className="grid gap-1 text-sm">Satıcı / şirkət adı<input name="displayName" required minLength={2} maxLength={120} defaultValue={displayName} className={field}/></label>
    <label className="grid gap-1 text-sm">Telefon<input name="phone" type="tel" minLength={5} maxLength={40} defaultValue={phone} className={field}/></label>
    <label className="grid gap-1 text-sm">Satıcı növü<select name="sellerType" required defaultValue="INDIVIDUAL_ENTREPRENEUR" className={field}><option value="INDIVIDUAL_ENTREPRENEUR">Fərdi sahibkar</option><option value="REGISTERED_COMPANY">Qeydiyyatdan keçmiş şirkət</option></select></label>
    <p className="text-sm leading-6 text-slate-600">Bu mərhələdə VÖEN tələb edilmir. Satıcı profili yaradıldıqdan sonra mağaza qaralaması aça bilərsiniz. Hüquqi məlumatlar admin yoxlamasına göndərilməzdən əvvəl mağaza profilində tamamlanmalıdır.</p>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <button disabled={busy} className="w-fit rounded-xl bg-[#173c40] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Göndərilir…" : "Satıcı kimi müraciət et"}</button>
  </form>;
}
