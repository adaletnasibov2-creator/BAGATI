"use client";

import { FormEvent, useEffect, useState } from "react";

type Banner = {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  buttonLabel: string;
  href: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  sortOrder: number;
};
type Option = { id: string; name: string };
type BannerForm = Omit<Banner, "id"> & { id?: string };
type FeaturedData = { products: Option[]; stores: Option[]; productIds: string[]; storeIds: string[] };

const blankBanner = (): BannerForm => ({
  title: "",
  description: "",
  imageUrl: "",
  buttonLabel: "Ətraflı",
  href: "/products",
  startsAt: "",
  endsAt: "",
  isActive: false,
  sortOrder: 0,
});
const input = "w-full rounded-xl border border-[#ded9cf] bg-white px-3 py-2.5 text-sm";
const localInputValue = (value: string) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export default function AdminHomepageManager() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [featured, setFeatured] = useState<FeaturedData>({ products: [], stores: [], productIds: [], storeIds: [] });
  const [form, setForm] = useState<BannerForm>(blankBanner);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const [bannerResponse, featuredResponse] = await Promise.all([
      fetch("/api/admin/homepage/banners", { cache: "no-store" }),
      fetch("/api/admin/homepage/featured", { cache: "no-store" }),
    ]);
    const [bannerData, featuredData] = await Promise.all([bannerResponse.json(), featuredResponse.json()]);
    if (!bannerResponse.ok) throw new Error(bannerData.error || "Bannerlər yüklənmədi.");
    if (!featuredResponse.ok) throw new Error(featuredData.error || "Ana səhifə seçimləri yüklənmədi.");
    setBanners(bannerData.items);
    setFeatured(featuredData);
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/admin/homepage/banners", { cache: "no-store" }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Bannerlər yüklənmədi.");
        if (active) setBanners(data.items);
      }),
      fetch("/api/admin/homepage/featured", { cache: "no-store" }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Ana səhifə seçimləri yüklənmədi.");
        if (active) setFeatured(data);
      }),
    ]).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Ana səhifə məlumatları yüklənmədi.");
    });
    return () => { active = false; };
  }, []);

  function setValue<K extends keyof BannerForm>(key: K, value: BannerForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function uploadImage(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/admin/homepage/assets", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Banner şəkli yüklənmədi.");
      setValue("imageUrl", data.asset.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Banner şəkli yüklənmədi.");
    } finally {
      setBusy(false);
    }
  }

  async function saveBanner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const payload = { ...form, startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString() };
      const response = await fetch(form.id ? `/api/admin/homepage/banners/${encodeURIComponent(form.id)}` : "/api/admin/homepage/banners", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Banner saxlanılmadı.");
      setMessage(data.message || "Banner yadda saxlanıldı.");
      setForm(blankBanner());
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Banner saxlanılmadı.");
    } finally {
      setBusy(false);
    }
  }

  async function saveFeatured(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/homepage/featured", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: featured.productIds, storeIds: featured.storeIds }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Seçilmiş məzmun saxlanılmadı.");
      setMessage(data.message || "Seçilmiş məzmun yadda saxlanıldı.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Seçilmiş məzmun saxlanılmadı.");
    } finally {
      setBusy(false);
    }
  }

  function editBanner(banner: Banner) {
    setForm({
      ...banner,
      startsAt: localInputValue(banner.startsAt),
      endsAt: localInputValue(banner.endsAt),
    });
    setError("");
    setMessage("");
  }

  function toggleSelection(kind: "productIds" | "storeIds", id: string, checked: boolean) {
    setFeatured((current) => ({
      ...current,
      [kind]: checked ? [...current[kind], id] : current[kind].filter((value) => value !== id),
    }));
  }

  return <div className="space-y-5">
    <section className="rounded-2xl border border-[#e7e3d9] bg-white p-5">
      <h2 className="font-semibold">{form.id ? "Banneri redaktə et" : "Yeni banner"}</h2>
      <form onSubmit={saveBanner} className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">Başlıq<input className={input} maxLength={160} required value={form.title} onChange={(event) => setValue("title", event.target.value)} /></label>
        <label className="grid gap-1 text-sm">Düymə mətni<input className={input} maxLength={80} required value={form.buttonLabel} onChange={(event) => setValue("buttonLabel", event.target.value)} /></label>
        <label className="grid gap-1 text-sm sm:col-span-2">Təsvir<textarea className={input} maxLength={1000} rows={3} value={form.description} onChange={(event) => setValue("description", event.target.value)} /></label>
        <label className="grid gap-1 text-sm sm:col-span-2">Şəkil HTTPS URL<input className={input} type="text" required value={form.imageUrl} onChange={(event) => setValue("imageUrl", event.target.value)} /></label>
        <label className="grid gap-1 text-sm sm:col-span-2">Şəkil yüklə (JPEG, PNG, WebP; maksimum 5 MB)
          <input className={input} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => void uploadImage(event.target.files?.[0])} />
        </label>
        <label className="grid gap-1 text-sm">Keçid (daxili yol və ya HTTPS URL)<input className={input} required value={form.href} onChange={(event) => setValue("href", event.target.value)} /></label>
        <label className="grid gap-1 text-sm">Sıra<input className={input} type="number" min={0} max={1000} step={1} required value={form.sortOrder} onChange={(event) => setValue("sortOrder", Number(event.target.value))} /></label>
        <label className="grid gap-1 text-sm">Başlama vaxtı<input className={input} type="datetime-local" required value={form.startsAt} onChange={(event) => setValue("startsAt", event.target.value)} /></label>
        <label className="grid gap-1 text-sm">Bitmə vaxtı<input className={input} type="datetime-local" required value={form.endsAt} onChange={(event) => setValue("endsAt", event.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={form.isActive} onChange={(event) => setValue("isActive", event.target.checked)} /> Aktivdir (yalnız tarix aralığında göstərilir)</label>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 sm:col-span-2">{error}</p>}
        {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 sm:col-span-2">{message}</p>}
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button disabled={busy} className="min-h-11 rounded-xl bg-[#173c40] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saxlanılır…" : form.id ? "Dəyişikliyi saxla" : "Banner yarat"}</button>
          {form.id && <button type="button" onClick={() => setForm(blankBanner())} className="min-h-11 rounded-xl border px-4 text-sm">Ləğv et</button>}
        </div>
      </form>
      <div className="mt-5 divide-y rounded-xl border">
        {banners.map((banner) => <div key={banner.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="min-w-0"><p className="font-medium">{banner.title}</p><p className="text-xs text-slate-500">{banner.isActive ? "Aktiv" : "Deaktiv"} · {new Date(banner.startsAt).toLocaleString("az-AZ")} — {new Date(banner.endsAt).toLocaleString("az-AZ")}</p></div>
          <button type="button" onClick={() => editBanner(banner)} className="min-h-10 rounded-lg border px-3 text-sm">Redaktə</button>
        </div>)}
        {!banners.length && <p className="p-4 text-sm text-slate-500">Banner yoxdur.</p>}
      </div>
    </section>

    <form onSubmit={saveFeatured} className="grid gap-5 rounded-2xl border border-[#e7e3d9] bg-white p-5 lg:grid-cols-2">
      <div><h2 className="font-semibold">Ana səhifədə seçilmiş məhsullar</h2><p className="mt-1 text-xs text-slate-500">Maksimum 12 seçim. Alışa yararlı olmayan məhsul müştəriyə göstərilmir.</p>
        <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border p-2">{featured.products.map((item) => <label key={item.id} className="flex items-center gap-2 rounded-lg p-2 text-sm hover:bg-slate-50"><input type="checkbox" checked={featured.productIds.includes(item.id)} onChange={(event) => toggleSelection("productIds", item.id, event.target.checked)} />{item.name}</label>)}</div>
      </div>
      <div><h2 className="font-semibold">Ana səhifədə seçilmiş mağazalar</h2><p className="mt-1 text-xs text-slate-500">Maksimum 12 seçim. Mağaza aktivlik və satış uyğunluğu şərtlərinə tabedir.</p>
        <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border p-2">{featured.stores.map((item) => <label key={item.id} className="flex items-center gap-2 rounded-lg p-2 text-sm hover:bg-slate-50"><input type="checkbox" checked={featured.storeIds.includes(item.id)} onChange={(event) => toggleSelection("storeIds", item.id, event.target.checked)} />{item.name}</label>)}</div>
      </div>
      <button disabled={busy} className="min-h-11 rounded-xl bg-[#173c40] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 lg:col-span-2">{busy ? "Saxlanılır…" : "Seçimləri yadda saxla"}</button>
    </form>
  </div>;
}
