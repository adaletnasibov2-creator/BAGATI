"use client";

import { useCallback, useEffect, useState } from "react";

type EmailJob = { id: string; template: string; status: string; attempts: number; availableAt: string; sentAt: string | null; lastErrorCode: string | null; retrySafe: boolean; createdAt: string };
type Status = { configured: boolean; encryptionConfigured: boolean; counts: { pending: number; processing: number; sent: number; failed: number }; items: EmailJob[] };

const azStatus: Record<string, string> = { PENDING: "Növbədə", PROCESSING: "Göndərilir", SENT: "Provayder qəbul edib", FAILED: "Uğursuz" };

export default function AdminEmailOperations() {
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
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
  async function runTool(path: "/api/admin/email/test" | "/api/admin/email/drain", key: string) {
    setBusy(key); setError(""); setNotice("");
    try {
      const response = await fetch(path, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Əməliyyat alınmadı.");
      setNotice(body.message || "Hazırdır.");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Xəta baş verdi."); }
    finally { setBusy(""); }
  }
  return <>
    <div><p className="text-kicker uppercase text-gold-700">ƏMƏLİYYAT</p><h1 className="mt-1.5 text-h1 text-fg">Email çatdırılması</h1><p className="mt-1 text-sm text-fg-secondary">Növbə PostgreSQL qeydlərindən oxunur. “Qəbul edib” provayderin qəbulunu bildirir, inbox-a çatdırılmanı yox.</p></div>
    {error && <p role="alert" className="mt-5 rounded-control border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {data && <>
      <section className="mt-6 rounded-card border border-line bg-white p-5"><p className="font-semibold">Email konfiqurasiyası</p><p className={`mt-2 text-sm ${data.configured && data.encryptionConfigured ? "text-emerald-800" : "text-amber-800"}`}>{!data.configured ? "SMTP tamamlanmayıb. Yoxlayın: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD və SMTP_FROM." : !data.encryptionConfigured ? "SMTP mövcuddur, lakin növbə məlumatlarının şifrələnməsi üçün SESSION_SECRET və ya 32 baytlıq EMAIL_ENCRYPTION_KEY düzgün qurulmayıb." : "SMTP dəyişənləri və email növbəsinin şifrələnməsi hazırdır."}</p><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(data.counts).map(([key, count]) => <div key={key} className="rounded-control bg-surface-page p-3"><p className="text-xs text-fg-secondary">{azStatus[key.toUpperCase()] ?? key}</p><b className="mt-1 block text-xl">{count}</b></div>)}</div><div className="mt-4 flex flex-wrap gap-2"><button onClick={() => void refresh().catch(cause => setError(cause instanceof Error ? cause.message : "Xəta"))} className="rounded-lg border px-3 py-2 text-sm">Yenilə</button><button disabled={!!busy} onClick={() => void runTool("/api/admin/email/test", "test")} className="rounded-lg border border-primary px-3 py-2 text-sm text-primary disabled:opacity-50">{busy === "test" ? "Göndərilir…" : "Test e-poçtu göndər"}</button><button disabled={!!busy} onClick={() => void runTool("/api/admin/email/drain", "drain")} className="rounded-lg bg-primary px-3 py-2 text-sm text-white disabled:opacity-50">{busy === "drain" ? "Göndərilir…" : "Növbəni indi göndər"}</button></div><p className="mt-2 text-xs text-fg-secondary">Test məktubu yalnız öz admin e-poçt ünvanınıza gedir. “Növbəni indi göndər” bir partiya (25 məktuba qədər) göndərir; avtomatik göndərici işləyirsə, gözləyin.</p>{notice && <p role="status" className="mt-3 rounded-control border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}</section>
      <section className="mt-5 overflow-hidden rounded-card border border-line bg-white"><div className="border-b p-5 font-semibold">Son məktublar</div>{data.items.length ? <div className="divide-y">{data.items.map(job => <article key={job.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium">{job.template}</p><p className="mt-1 text-xs text-fg-secondary">{azStatus[job.status] ?? job.status} · Cəhd: {job.attempts} · {new Date(job.createdAt).toLocaleString("az-AZ")}{job.lastErrorCode ? ` · ${job.lastErrorCode}` : ""}</p></div>{job.status === "FAILED" && job.retrySafe && <button disabled={!!busy} onClick={() => void retry(job.id)} className="rounded-lg bg-primary px-3 py-2 text-sm text-white disabled:opacity-50">{busy === job.id ? "Gözləyin…" : "Təhlükəsiz təkrar"}</button>}</article>)}</div> : <p className="p-5 text-sm text-fg-secondary">Email növbəsi boşdur.</p>}</section>
    </>}
  </>;
}
