"use client";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { presentStockQuantity } from "@/lib/stock-quantity";

type Adjustment = { id: string; delta: number; reason: string; createdAt: string };
type Row = {
  id: string; productId: string; quantity: number; reserved: number; lowStockThreshold: number; updatedAt?: string;
  product: { name: string; sku: string | null };
  variant: { id: string; name: string; sku: string | null; options: Record<string, unknown> | null; isActive: boolean } | null;
  adjustments?: Adjustment[];
};

const input = "w-full rounded-xl border border-[#ded9cf] bg-white px-3 py-2.5 text-sm";
type Filter = "" | "low" | "out" | "ok";

function levelOf(row: Row) {
  const available = Math.max(0, row.quantity - row.reserved);
  return available <= 0 ? "out" : available <= row.lowStockThreshold ? "low" : "ok";
}

export default function VendorInventoryPanel({ storeId }: { storeId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("");
  const [saving, setSaving] = useState("");
  const [messages, setMessages] = useState<Record<string, { ok: boolean; text: string }>>({});
  const url = `/api/vendor/${encodeURIComponent(storeId)}/inventory`;

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(url, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Anbar qalığını yükləmək mümkün olmadı.");
      setRows(data.items || []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Anbar qalığını yükləmək mümkün olmadı.");
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => rows.reduce((acc, row) => { acc[levelOf(row)]++; return acc; }, { ok: 0, low: 0, out: 0 } as Record<string, number>), [rows]);
  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("az-AZ");
    return rows
      .filter((row) => !filter || levelOf(row) === filter)
      .filter((row) => !term || [row.product.name, row.product.sku, row.variant?.name, row.variant?.sku].some((value) => value?.toLocaleLowerCase("az-AZ").includes(term)))
      .sort((a, b) => ({ out: 0, low: 1, ok: 2 }[levelOf(a)] - { out: 0, low: 1, ok: 2 }[levelOf(b)]) || a.product.name.localeCompare(b.product.name, "az"));
  }, [rows, search, filter]);

  async function save(event: FormEvent<HTMLFormElement>, row: Row) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const quantity = presentStockQuantity(form.get("quantity"));
    const lowStockThreshold = presentStockQuantity(form.get("lowStockThreshold"));
    const reason = String(form.get("reason") || "").trim();
    const fail = (text: string) => setMessages((current) => ({ ...current, [row.id]: { ok: false, text } }));
    if (quantity === null) return fail("Miqdar 0 və ya daha böyük tam ədəd olmalıdır.");
    if (lowStockThreshold === null) return fail("Xəbərdarlıq həddi 0 və ya daha böyük tam ədəd olmalıdır.");
    if (quantity < row.reserved) return fail(`Miqdar sifarişlər üçün ayrılmış ${row.reserved} ədəddən az ola bilməz.`);
    if (reason.length < 2) return fail("Dəyişikliyin səbəbini qısaca yazın (məs. “Yeni mal gəldi”).");
    setSaving(row.id);
    try {
      const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id, quantity, lowStockThreshold, reason }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Anbar qalığı yenilənmədi.");
      setMessages((current) => ({ ...current, [row.id]: { ok: true, text: "Yadda saxlanıldı." } }));
      await load();
    } catch (reason) {
      fail(reason instanceof Error ? reason.message : "Anbar qalığı yenilənmədi.");
    } finally {
      setSaving("");
    }
  }

  const label = (row: Row) => row.variant
    ? Object.entries(row.variant.options || {}).map(([key, value]) => `${key}: ${String(value)}`).join(" / ") || row.variant.name
    : "Əsas məhsul";

  return <div className="mt-5 space-y-4">
    <div className="grid gap-3 sm:grid-cols-3">
      {([["", "Bütün qeydlər", rows.length, "text-[#142d38]"], ["low", "Az qalıb", counts.low, "text-amber-700"], ["out", "Stokda yoxdur", counts.out, "text-red-700"]] as const).map(([key, title, value, tone]) => <button key={title} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key} className={`rounded-2xl border bg-white p-4 text-left transition ${filter === key ? "border-[#173c40] ring-1 ring-[#173c40]" : "border-[#e9e4da] hover:border-[#cbb47e]"}`}><p className="text-sm text-slate-500">{title}</p><b className={`mt-1 block text-2xl ${tone}`}>{value}</b></button>)}
    </div>
    <div className="grid gap-3 rounded-2xl border border-[#e9e4da] bg-white p-4 sm:grid-cols-[1fr_200px]">
      <label className="grid gap-1 text-xs text-slate-500">Axtar<input className={input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Məhsul adı, seçim və ya məhsul kodu"/></label>
      <label className="grid gap-1 text-xs text-slate-500">Vəziyyət<select className={input} value={filter} onChange={(e) => setFilter(e.target.value as Filter)}><option value="">Hamısı</option><option value="low">Az qalıb</option><option value="out">Stokda yoxdur</option><option value="ok">Kifayət qədər var</option></select></label>
    </div>
    <p className="text-xs text-slate-500">Sifariş verildikdə miqdar avtomatik azalır, sifariş ləğv edildikdə geri qaytarılır. Satışa açıq qalıq = ümumi miqdar − ayrılmış miqdar.</p>
    {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    {loading ? <div className="rounded-2xl border border-[#e9e4da] bg-white p-6 text-sm text-slate-500" role="status">Anbar qalığı yüklənir…</div>
      : !rows.length ? <div className="rounded-2xl border border-[#e9e4da] bg-white p-8 text-center text-sm text-slate-500">Hələ məhsul yoxdur. <Link href={`/vendor/${storeId}/products/new`} className="font-medium text-[#28766f] underline">İlk məhsulu əlavə edin</Link>.</div>
      : !visible.length ? <div className="rounded-2xl border border-[#e9e4da] bg-white p-6 text-sm text-slate-500">Axtarışa uyğun qeyd tapılmadı.</div>
      : <div className="grid gap-3">{visible.map((row) => {
        const available = Math.max(0, row.quantity - row.reserved), level = levelOf(row), message = messages[row.id];
        return <article key={row.id} className="rounded-2xl border border-[#e9e4da] bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0"><Link href={`/vendor/${storeId}/products/${row.productId}`} className="break-words font-semibold text-[#173c40] hover:underline">{row.product.name}</Link><p className="mt-1 break-words text-sm text-slate-600">{label(row)}{row.variant && !row.variant.isActive ? " · Satışdan çıxarılıb" : ""}</p><p className="mt-1 text-xs text-slate-500">Məhsul kodu: {row.variant?.sku || row.product.sku || "—"}</p></div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${level === "out" ? "bg-red-50 text-red-700" : level === "low" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>{level === "out" ? "Stokda yoxdur" : level === "low" ? "Az qalıb" : "Mövcuddur"} · {available} ədəd satışa açıq</span>
          </div>
          <form key={`${row.id}:${row.quantity}:${row.lowStockThreshold}:${row.updatedAt ?? ""}`} onSubmit={(event) => void save(event, row)} className="mt-3 grid gap-2 sm:grid-cols-[120px_140px_1fr_auto] sm:items-end">
            <label className="grid gap-1 text-xs text-slate-500">Ümumi miqdar<input className={input} name="quantity" type="number" min={row.reserved} step="1" inputMode="numeric" defaultValue={row.quantity} required/></label>
            <label className="grid gap-1 text-xs text-slate-500">Xəbərdarlıq həddi<input className={input} name="lowStockThreshold" type="number" min="0" step="1" inputMode="numeric" defaultValue={row.lowStockThreshold} required/></label>
            <label className="grid gap-1 text-xs text-slate-500">Səbəb<input className={input} name="reason" placeholder="Məs.: Yeni mal gəldi" maxLength={300} required/></label>
            <button disabled={saving === row.id} className="min-h-11 rounded-xl bg-[#173c40] px-4 text-sm font-medium text-white disabled:opacity-50">{saving === row.id ? "Saxlanılır…" : "Yenilə"}</button>
          </form>
          <p className="mt-2 text-xs text-slate-500">Ayrılıb: {row.reserved} ədəd</p>
          {message && <p role="status" className={`mt-2 text-sm ${message.ok ? "text-emerald-700" : "text-red-700"}`}>{message.text}</p>}
          {row.adjustments && row.adjustments.length > 0 && <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer select-none font-medium text-[#536273]">Son dəyişikliklər ({row.adjustments.length})</summary><ul className="mt-2 space-y-1">{row.adjustments.map((adjustment) => <li key={adjustment.id}>{new Date(adjustment.createdAt).toLocaleString("az-AZ")} · <b className={adjustment.delta < 0 ? "text-red-700" : "text-emerald-700"}>{adjustment.delta > 0 ? "+" : ""}{adjustment.delta}</b> · {adjustmentReason(adjustment.reason)}</li>)}</ul></details>}
        </article>;
      })}</div>}
  </div>;
}

/** Older stock history rows were written with an English system reason. */
function adjustmentReason(reason: string) {
  return reason === "Customer order stock deduction" ? "Sifarişə görə stokdan çıxıldı" : reason;
}
