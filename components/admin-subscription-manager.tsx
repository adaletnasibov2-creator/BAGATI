"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirmDialog } from "@/components/admin-ui/confirm-dialog";
import { adminStatusLabel } from "@/lib/admin-labels";

type Plan = { id: string; slug: string; name: string; monthlyPrice: number | string };
type Subscription = {
  id: string;
  planId: string;
  status: string;
  currentPeriodStart: string | Date | null;
  currentPeriodEnd: string | Date | null;
  accessSource: string;
  grantReason: string | null;
  grantedByAdmin?: { email: string } | null;
  plan: { name: string; monthlyPrice: number | string };
} | null;

const statusOptions = ["PENDING", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED", "EXPIRED"];
function dateInput(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function defaultEnd() {
  const date = new Date();
  date.setMonth(date.getMonth() + 1);
  return dateInput(date);
}

export default function AdminSubscriptionManager({ storeId, plans, subscription }: { storeId: string; plans: Plan[]; subscription: Subscription }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirmDialog();
  const [planId, setPlanId] = useState(subscription?.planId ?? plans.find((plan) => plan.slug === "basic")?.id ?? "");
  const [status, setStatus] = useState(subscription?.status ?? "PENDING");
  const [periodStart, setPeriodStart] = useState(dateInput(subscription?.currentPeriodStart) || dateInput(new Date()));
  const [periodEnd, setPeriodEnd] = useState(dateInput(subscription?.currentPeriodEnd) || defaultEnd());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function save() {
    if (busy) return;
    if (!reason.trim()) { setError("Əl ilə dəyişiklik üçün səbəb qeyd edin."); return; }
    if (status === "ACTIVE" && !await confirm("Bu, ödənişsiz əl ilə aktivləşdirmədir. Heç bir ödəniş qeydə alınmayacaq. Davam edilsin?")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/subscriptions", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, planId, status, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, reason }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Abunəlik yenilənmədi.");
      setMessage(result.message || "Əl ilə abunəlik dəyişikliyi saxlanıldı.");
      setReason("");
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Sorğu tamamlanmadı."); }
    finally { setBusy(false); }
  }

  const input = "min-h-10 w-full rounded-lg border border-[#ded9cf] bg-white px-3 py-2 text-sm";
  return <div className="mt-4 rounded-xl border border-[#e7e3d9] bg-[#fbfaf7] p-4">{dialog}
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div><h3 className="font-semibold">Abunəliyə əl ilə nəzarət</h3><p className="mt-1 text-xs text-slate-600">Əl ilə verilən giriş ödəniş və ya ödəniş təsdiqi deyil.</p></div>
      {subscription && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900">{subscription.accessSource === "PAYMENT_CONFIRMED" ? "Ödəniş təsdiqlənib" : subscription.accessSource === "ADMIN_MANUAL" ? "Admin tərəfindən əl ilə" : "Mənbə məlum deyil"}</span>}
    </div>
    {subscription && <p className="mb-3 text-xs text-slate-600">Son əl ilə səbəb: {subscription.grantReason || "—"}{subscription.grantedByAdmin?.email ? ` · ${subscription.grantedByAdmin.email}` : ""}</p>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <label className="grid gap-1 text-xs text-slate-600">Plan<select className={input} value={planId} onChange={(event) => setPlanId(event.target.value)}>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {Number(plan.monthlyPrice).toFixed(2)} ₼/ay</option>)}</select></label>
      <label className="grid gap-1 text-xs text-slate-600">Status<select className={input} value={status} onChange={(event) => setStatus(event.target.value)}>{statusOptions.map((value) => <option key={value} value={value}>{adminStatusLabel("subscription", value)}</option>)}</select></label>
      <label className="grid gap-1 text-xs text-slate-600">Dövrün başlanğıcı<input className={input} type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} required /></label>
      <label className="grid gap-1 text-xs text-slate-600">Dövrün sonu<input className={input} type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} required /></label>
      <label className="grid gap-1 text-xs text-slate-600 sm:col-span-2">Dəyişiklik səbəbi<textarea className={input} minLength={8} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} required /></label>
    </div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-2.5 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-2.5 text-sm text-emerald-800">{message}</p>}
    <button type="button" disabled={busy || !planId || !periodStart || !periodEnd} onClick={() => void save()} className="mt-3 min-h-10 rounded-lg bg-[#173c40] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Yadda saxlanılır…" : subscription ? "Dəyişikliyi saxla" : "Abunəlik yarat və saxla"}</button>
  </div>;
}
