"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { ImagePlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";

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

  // Dropzone: the file input covers the whole box (transparent), so a click opens the picker and a dropped file goes
  // through the same onChange upload as before (same limits, same messages).
  return <section className="grid min-w-0 gap-3 sm:col-span-2">
    <div><h3 className="text-sm font-semibold text-fg">{label}</h3><p className="mt-1 text-xs leading-5 text-fg-muted">JPEG, PNG və ya WebP · hər fayl maksimum 5 MB · ən çox 12 şəkil</p></div>
    {name && <input type="hidden" name={name} value={urls.join("\n")}/>}
    <label data-vendor-dropzone="" className={`relative flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-control border-2 border-dashed px-4 py-6 text-center transition-colors focus-within:border-primary focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus ${busy ? "border-brand-200 bg-primary-subtle" : "border-line-strong bg-surface-page hover:border-primary hover:bg-primary-subtle"}`}>
      <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-full bg-white text-primary ring-1 ring-inset ring-brand-100"><ImagePlus size={20}/></span>
      <span className="text-sm font-semibold text-primary">{busy ? "Yüklənir…" : "Şəkil seç və yüklə"}</span>
      <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={upload} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-wait"/>
    </label>
    {message && <p role="status" className="text-sm text-fg-secondary">{message}</p>}
    {urls.length ? <ul className="grid grid-cols-2 gap-3 min-[480px]:grid-cols-3 sm:grid-cols-4 lg:grid-cols-5">{urls.map((url, index) => <li key={`${url}-${index}`}><figure className={`relative aspect-square overflow-hidden rounded-control border bg-surface-sunken ${index === 0 ? "border-primary ring-1 ring-primary" : "border-line"}`}><img src={url} alt={`${label}, ${index + 1}-ci şəkil`} className="h-full w-full object-cover"/>{index === 0 && <span className="absolute left-1.5 top-1.5"><Badge tone="primary" className="shadow-subtle">Əsas şəkil</Badge></span>}<figcaption className="sr-only">{index === 0 ? "Əsas şəkil" : `Şəkil ${index + 1}`}</figcaption><div className="absolute inset-x-1.5 bottom-1.5 flex justify-between gap-1"><span className="flex gap-1"><button type="button" disabled={index === 0} aria-label="Şəkli sola çək" onClick={() => moveImage(index, -1)} className="grid h-8 min-w-8 place-items-center rounded-full bg-white/95 px-2 text-xs font-medium text-fg shadow-subtle ring-1 ring-inset ring-line transition-colors hover:bg-white hover:text-primary disabled:opacity-40">←</button><button type="button" disabled={index === urls.length - 1} aria-label="Şəkli sağa çək" onClick={() => moveImage(index, 1)} className="grid h-8 min-w-8 place-items-center rounded-full bg-white/95 px-2 text-xs font-medium text-fg shadow-subtle ring-1 ring-inset ring-line transition-colors hover:bg-white hover:text-primary disabled:opacity-40">→</button></span><button type="button" aria-label="Şəkli sil" onClick={() => update(urls.filter((_, i) => i !== index))} className="grid h-8 min-w-8 place-items-center rounded-full bg-white/95 px-2 text-xs font-medium text-fg shadow-subtle ring-1 ring-inset ring-line transition-colors hover:bg-white hover:text-primary disabled:opacity-40 text-danger hover:text-danger">Sil</button></div></figure></li>)}</ul> : <p className="text-sm text-fg-muted">Şəkil yoxdur. Məhsulda “Şəkil yoxdur” görünəcək.</p>}
  </section>;
}
