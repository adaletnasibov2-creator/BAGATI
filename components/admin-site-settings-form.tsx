"use client";

import { FormEvent, useState } from "react";

export type SiteSettingsFormValue = {
  siteName: string;
  logoUrl: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  tiktokUrl: string | null;
  deliveryInfo: string;
  returnsInfo: string;
  homeIntroTitle: string;
  homeIntroDescription: string;
  homeIntroLinkLabel: string;
  homeIntroLinkUrl: string;
};

const input = "w-full rounded-xl border border-[#ded9cf] bg-white px-3 py-2.5 text-sm";

export default function AdminSiteSettingsForm({ initial }: { initial: SiteSettingsFormValue }) {
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);

  function update(key: keyof SiteSettingsFormValue, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function uploadLogo(file?: File) {
    if (!file) return;
    setUploadBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/admin/homepage/assets", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Logo yüklənmədi.");
      update("logoUrl", result.asset.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Logo yüklənmədi.");
    } finally {
      setUploadBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/site-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Parametrlər saxlanılmadı.");
      setValues(result.item);
      setMessage(result.message || "Parametrlər yadda saxlanıldı.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Parametrlər saxlanılmadı.");
    } finally {
      setBusy(false);
    }
  }

  const textField = (key: keyof SiteSettingsFormValue, label: string, type = "text", required = false) => (
    <label className="grid gap-1 text-sm text-slate-700">{label}
      <input className={input} type={type} required={required} value={values[key] ?? ""} onChange={(event) => update(key, event.target.value)} />
    </label>
  );
  const longField = (key: "deliveryInfo" | "returnsInfo" | "homeIntroDescription", label: string, maxLength: number) => (
    <label className="grid gap-1 text-sm text-slate-700">{label}
      <textarea className={input} maxLength={maxLength} rows={4} value={values[key]} onChange={(event) => update(key, event.target.value)} />
    </label>
  );

  return <form onSubmit={save} className="space-y-5">
    <section className="grid gap-4 rounded-2xl border border-[#e7e3d9] bg-white p-5 sm:grid-cols-2">
      <h2 className="font-semibold sm:col-span-2">Brend və əlaqə</h2>
      {textField("siteName", "Sayt adı", "text", true)}
      <label className="grid gap-1 text-sm text-slate-700">Logo şəkil URL
        <input className={input} type="text" value={values.logoUrl ?? ""} onChange={(event) => update("logoUrl", event.target.value)} />
      </label>
      <label className="grid gap-1 text-sm text-slate-700">Logo yüklə (JPEG, PNG, WebP; maksimum 5 MB)
        <input className={input} type="file" accept="image/jpeg,image/png,image/webp" disabled={uploadBusy} onChange={(event) => void uploadLogo(event.target.files?.[0])} />
      </label>
      {textField("contactPhone", "Əlaqə telefonu", "tel")}
      {textField("contactEmail", "Əlaqə e-poçtu", "email")}
    </section>
    <section className="grid gap-4 rounded-2xl border border-[#e7e3d9] bg-white p-5 sm:grid-cols-2">
      <h2 className="font-semibold sm:col-span-2">Sosial şəbəkələr (yalnız HTTPS)</h2>
      {textField("instagramUrl", "Instagram URL", "url")}
      {textField("facebookUrl", "Facebook URL", "url")}
      {textField("tiktokUrl", "TikTok URL", "url")}
    </section>
    <section className="grid gap-4 rounded-2xl border border-[#e7e3d9] bg-white p-5">
      <h2 className="font-semibold">Çatdırılma və qaytarılma</h2>
      {longField("deliveryInfo", "Çatdırılma məlumatı", 5000)}
      {longField("returnsInfo", "Qaytarılma məlumatı", 5000)}
    </section>
    <section className="grid gap-4 rounded-2xl border border-[#e7e3d9] bg-white p-5 sm:grid-cols-2">
      <h2 className="font-semibold sm:col-span-2">Ana səhifə təqdimat mətni</h2>
      {textField("homeIntroTitle", "Başlıq", "text", true)}
      {textField("homeIntroLinkLabel", "Düymə mətni", "text", true)}
      {longField("homeIntroDescription", "Təsvir", 1000)}
      {textField("homeIntroLinkUrl", "Düymə keçidi (daxili yol və ya HTTPS)", "text", true)}
    </section>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    <button disabled={busy || uploadBusy} className="min-h-11 rounded-xl bg-[#173c40] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
      {busy ? "Saxlanılır…" : "Parametrləri yadda saxla"}
    </button>
  </form>;
}
