"use client";

import { ChangeEvent, useEffect, useState } from "react";

type Props = { storeId: string; initialUrls?: string[]; name?: string | null; label?: string; onChange?: (urls: string[]) => void };

export default function VendorImageUploader({ storeId, initialUrls = [], name = "images", label = "Məhsul şəkilləri", onChange }: Props) {
  const [urls, setUrls] = useState(initialUrls);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => setUrls(initialUrls), [initialUrls.join("|")]);
  const update = (next: string[]) => { setUrls(next); onChange?.(next); };

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    if (urls.length + files.length > 12) { setMessage("Bir variant üçün ən çox 12 şəkil əlavə etmək olar."); return; }
    setBusy(true); setMessage("");
    const added: string[] = [];
    try {
      for (const file of files) {
        const form = new FormData(); form.set("file", file);
        const response = await fetch(`/api/vendor/${storeId}/assets`, { method: "POST", body: form });
        const result = await response.json();
        if (!response.ok) throw new Error(`${file.name}: ${result.error || "Yükləmə uğursuz oldu"}`);
        added.push(result.asset.url as string);
      }
      update([...urls, ...added]); setMessage(`${added.length} şəkil yadda saxlanıldı.`);
    } catch (error) {
      if (added.length) update([...urls, ...added]);
      setMessage(error instanceof Error ? error.message : "Şəkil yüklənmədi.");
    } finally { setBusy(false); }
  }

  function moveImage(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= urls.length) return;
    const next = [...urls]; [next[index], next[target]] = [next[target], next[index]]; update(next);
  }

  return <section className="grid gap-3 sm:col-span-2">
    <div><h3 className="text-sm font-medium text-slate-700">{label}</h3><p className="mt-1 text-xs text-slate-500">JPEG, PNG və ya WebP · hər fayl maksimum 5 MB · ən çox 12 şəkil</p></div>
    {name && <input type="hidden" name={name} value={urls.join("\n")}/>}
    <label className="inline-flex w-fit cursor-pointer items-center rounded-xl border border-[#ded9cf] bg-white px-4 py-2.5 text-sm font-medium hover:border-[#b89758]">{busy ? "Yüklənir…" : "Şəkil seç və yüklə"}<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={upload} className="sr-only"/></label>
    {message && <p role="status" className="text-sm text-slate-600">{message}</p>}
    {urls.length ? <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">{urls.map((url, index) => <figure key={`${url}-${index}`} className="relative aspect-square overflow-hidden rounded-xl border border-[#e8e4db] bg-[#f4f2ed]"><img src={url} alt={`${label}, ${index + 1}-ci şəkil`} className="h-full w-full object-cover"/><figcaption className="absolute bottom-0 left-0 right-0 bg-white/95 p-1 text-center text-[10px]">{index === 0 ? "Əsas şəkil" : `Şəkil ${index + 1}`}</figcaption><div className="absolute right-1 top-1 flex gap-1"><button type="button" disabled={index === 0} aria-label="Şəkli sola çək" onClick={() => moveImage(index, -1)} className="rounded-full bg-white/95 px-2 py-1 text-xs shadow disabled:opacity-40">←</button><button type="button" disabled={index === urls.length - 1} aria-label="Şəkli sağa çək" onClick={() => moveImage(index, 1)} className="rounded-full bg-white/95 px-2 py-1 text-xs shadow disabled:opacity-40">→</button><button type="button" aria-label="Şəkli sil" onClick={() => update(urls.filter((_, i) => i !== index))} className="rounded-full bg-white/95 px-2 py-1 text-xs shadow">Sil</button></div></figure>)}</div> : <p className="text-sm text-slate-500">Şəkil yoxdur. Məhsulda “Şəkil yoxdur” görünəcək.</p>}
  </section>;
}
