"use client";

import { useCallback, useEffect, useState } from "react";

type EmailJob = { id: string; template: string; status: string; attempts: number; availableAt: string; sentAt: string | null; lastErrorCode: string | null; retrySafe: boolean; createdAt: string };
type Status = { configured: boolean; encryptionConfigured: boolean; counts: { pending: number; processing: number; sent: number; failed: number }; items: EmailJob[] };

const azStatus: Record<string, string> = { PENDING: "Növbədə", PROCESSING: "Göndərilir", SENT: "Provayder qəbul edib", FAILED: "Uğursuz" };

export default function AdminEmailOperations() {
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const refresh = useCallback(async () => {
    const response = await fetch("/api/admin/email", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Məlumatları yükləmək mümkün olmadı.");
    setData(body);
  }, []);
  useEffect(() => { void refresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Xəta baş verdi.")); }, [refresh]);
  async function retry(id: string) {
    setBusy(id); setError("");
    try {
      const response = await fetch("/api/admin/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Təkrar göndərmə mümkün olmadı.");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Xəta baş verdi."); }
    finally { setBusy(""); }
  }
  return <>
    <div><p className="text-xs font-semibold uppercase tracking-[.18em] text-[#9b7840]">ƏMƏLİYYAT</p><h1 className="mt-2 text-3xl font-semibold text-[#0d1b2a]">Email çatdırılması</h1><p className="mt-1 text-sm text-slate-500">Növbə PostgreSQL qeydlərindən oxunur. “Qəbul edib” provayderin qəbulunu bildirir, inbox-a çatdırılmanı yox.</p></div>
    {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {data && <>
      <section className="mt-6 rounded-2xl border border-[#e7e3d9] bg-white p-5"><p className="font-semibold">Email konfiqurasiyası</p><p className={`mt-2 text-sm ${data.configured && data.encryptionConfigured ? "text-emerald-800" : "text-amber-800"}`}>{!data.configured ? "SMTP tamamlanmayıb. Yoxlayın: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD və SMTP_FROM." : !data.encryptionConfigured ? "SMTP mövcuddur, lakin növbə məlumatlarının şifrələnməsi üçün SESSION_SECRET və ya 32 baytlıq EMAIL_ENCRYPTION_KEY düzgün qurulmayıb." : "SMTP dəyişənləri və email növbəsinin şifrələnməsi hazırdır."}</p><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(data.counts).map(([key, count]) => <div key={key} className="rounded-xl bg-[#f8f7f4] p-3"><p className="text-xs text-slate-500">{azStatus[key.toUpperCase()] ?? key}</p><b className="mt-1 block text-xl">{count}</b></div>)}</div><button onClick={() => void refresh().catch(cause => setError(cause instanceof Error ? cause.message : "Xəta"))} className="mt-4 rounded-lg border px-3 py-2 text-sm">Yenilə</button></section>
      <section className="mt-5 overflow-hidden rounded-2xl border border-[#e7e3d9] bg-white"><div className="border-b p-5 font-semibold">Son məktublar</div>{data.items.length ? <div className="divide-y">{data.items.map(job => <article key={job.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium">{job.template}</p><p className="mt-1 text-xs text-slate-500">{azStatus[job.status] ?? job.status} · Cəhd: {job.attempts} · {new Date(job.createdAt).toLocaleString("az-AZ")}{job.lastErrorCode ? ` · ${job.lastErrorCode}` : ""}</p></div>{job.status === "FAILED" && job.retrySafe && <button disabled={!!busy} onClick={() => void retry(job.id)} className="rounded-lg bg-[#173c40] px-3 py-2 text-sm text-white disabled:opacity-50">{busy === job.id ? "Gözləyin…" : "Təhlükəsiz təkrar"}</button>}</article>)}</div> : <p className="p-5 text-sm text-slate-500">Email növbəsi boşdur.</p>}</section>
    </>}
  </>;
}
