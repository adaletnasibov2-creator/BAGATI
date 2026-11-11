"use client";
import { useEffect, useState } from "react";
import { Star } from "lucide-react";

type Review = { id: string; rating: number; comment: string | null; createdAt: string; author: string; product: { id: string; name: string } };
type Summary = { average: number | null; total: number; distribution: Record<string, number> };

export default function VendorReviews({ storeId }: { storeId: string }) {
  const [items, setItems] = useState<Review[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rating, setRating] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    fetch(`/api/vendor/${encodeURIComponent(storeId)}/reviews${rating ? `?rating=${rating}` : ""}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Rəyləri yükləmək mümkün olmadı.");
        if (active) { setItems(data.items || []); setSummary(data.summary || null); }
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Rəyləri yükləmək mümkün olmadı."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [storeId, rating]);

  const stars = (value: number) => <span className="text-[#c9973a]" aria-label={`${value} ulduz`}>{"★".repeat(value)}<span className="text-slate-300">{"★".repeat(5 - value)}</span></span>;

  return <div className="mt-5 space-y-4">
    {summary && <section className="grid gap-3 rounded-2xl border border-[#e9e4da] bg-white p-5 sm:grid-cols-[180px_1fr]">
      <div><p className="text-sm text-slate-500">Orta qiymət</p><p className="mt-1 flex items-center gap-2 text-3xl font-semibold text-[#142d38]">{summary.average ? summary.average.toFixed(1) : "—"}<Star size={22} className="fill-[#c9973a] text-[#c9973a]" aria-hidden="true"/></p><p className="mt-1 text-xs text-slate-500">{summary.total} rəy</p></div>
      <div className="space-y-1.5">{[5, 4, 3, 2, 1].map((value) => { const count = summary.distribution[value] || 0; const width = summary.total ? Math.round((count / summary.total) * 100) : 0; return <button key={value} type="button" onClick={() => setRating(rating === value ? 0 : value)} aria-pressed={rating === value} className={`flex w-full items-center gap-3 rounded-lg px-2 py-1 text-left text-xs ${rating === value ? "bg-[#f4ecd9]" : "hover:bg-[#f7f5ef]"}`}><span className="w-14 shrink-0">{value} ulduz</span><span className="h-2 flex-1 overflow-hidden rounded-full bg-[#eeeae2]"><span className="block h-full rounded-full bg-[#c9973a]" style={{ width: `${width}%` }}/></span><span className="w-8 shrink-0 text-right">{count}</span></button>; })}</div>
    </section>}
    {rating > 0 && <p className="text-sm text-slate-600">Yalnız {rating} ulduzlu rəylər göstərilir. <button type="button" onClick={() => setRating(0)} className="font-medium text-[#28766f] underline">Filtri sıfırla</button></p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    {loading ? <div className="rounded-2xl border border-[#e9e4da] bg-white p-6 text-sm text-slate-500" role="status">Rəylər yüklənir…</div>
      : items.length ? <div className="grid gap-3">{items.map((item) => <article key={item.id} className="rounded-2xl border border-[#e9e4da] bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-2"><b className="min-w-0 break-words text-[#142d38]">{item.product.name}</b>{stars(item.rating)}</div><p className="mt-2 whitespace-pre-line break-words text-sm text-slate-700">{item.comment || "Alıcı yalnız ulduz qiyməti verib."}</p><p className="mt-2 text-xs text-slate-500">{item.author} · {new Date(item.createdAt).toLocaleDateString("az-AZ")}</p></article>)}</div>
      : <div className="rounded-2xl border border-[#e9e4da] bg-white p-8 text-center text-sm text-slate-500">{rating ? "Bu qiymətlə rəy yoxdur." : "Hələ rəy yoxdur. Alıcılar məhsul aldıqdan sonra rəy yaza bilər."}</div>}
    <p className="text-xs text-slate-500">Rəylər alıcılara məxsusdur və satıcı tərəfindən dəyişdirilə və ya silinə bilməz. Rəyə cavab yazmaq və uyğunsuz rəyi bildirmək imkanı hazırda mövcud deyil.</p>
  </div>;
}
