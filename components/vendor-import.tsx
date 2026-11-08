"use client";

import { ChangeEvent, useState } from "react";

type Row = Record<string, string>;
type Validation = { index: number; status: "VALID" | "INVALID" | "WARNING"; errors: string[]; warnings: string[]; product: Record<string, unknown> };
type ImportMode = "create" | "update" | "mixed";
const fields: Record<string, string> = { name: "Məhsul adı", sku: "SKU", price: "Qiymət", discountPrice: "Endirimli qiymət", category: "Kateqoriya", brand: "Brend", quantity: "Stok", lowStockThreshold: "Az stok həddi", description: "Təsvir", images: "Şəkil URL-ləri", variants: "Variantlar (JSON)" };
const input = "w-full rounded-xl border border-[#ded9cf] bg-white px-3 py-2.5 text-sm";
const template = "\uFEFFname,sku,description,price,discountPrice,category,brand,quantity,lowStockThreshold,images,variants\r\n";

function parseCsv(text: string): { headers: string[]; rows: Row[] } {
  const matrix: string[][] = []; let row: string[] = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && text[i + 1] === '"' && quoted) { value += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === "," && !quoted) { row.push(value); value = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) { if (c === "\r" && text[i + 1] === "\n") i++; row.push(value); matrix.push(row); row = []; value = ""; }
    else value += c;
  }
  if (value || row.length) { row.push(value); matrix.push(row); }
  const headers = (matrix.shift() || []).map(header => header.trim());
  return { headers, rows: matrix.filter(values => values.some(value => value.trim())).map(values => Object.fromEntries(headers.map((header, index) => [header, (values[index] || "").trim()]))) };
}

async function unzipEntry(buffer: ArrayBuffer, target: string): Promise<string | null> {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer); let at = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) if (view.getUint32(i, true) === 0x06054b50) { at = i; break; }
  if (at < 0) throw new Error("Excel faylının arxivi oxunmadı.");
  const count = view.getUint16(at + 10, true); let cursor = view.getUint32(at + 16, true);
  if (count > 1024) throw new Error("Excel faylında çox sayda arxiv elementi var.");
  for (let i = 0; i < count; i++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) break;
    const method = view.getUint16(cursor + 10, true), size = view.getUint32(cursor + 20, true), uncompressedSize = view.getUint32(cursor + 24, true), nameLen = view.getUint16(cursor + 28, true), extraLen = view.getUint16(cursor + 30, true), commentLen = view.getUint16(cursor + 32, true), local = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLen));
    if (name === target) {
      if (uncompressedSize > 10 * 1024 * 1024) throw new Error("Excel vərəqi 10 MB-dan böyük açıla bilməz.");
      const dataAt = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true), raw = bytes.slice(dataAt, dataAt + size);
      if (method === 0) return new TextDecoder().decode(raw);
      if (method !== 8) throw new Error("Excel faylının sıxılma formatı dəstəklənmir.");
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw" as CompressionFormat));
      const reader = stream.getReader(), chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > 10 * 1024 * 1024) {
          await reader.cancel();
          throw new Error("Excel vərəqi 10 MB-dan böyük açıla bilməz.");
        }
        chunks.push(value);
      }
      const expanded = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        expanded.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder().decode(expanded);
    }
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

async function parseXlsx(file: File): Promise<{ headers: string[]; rows: Row[] }> {
  const buffer = await file.arrayBuffer(), stringsXml = await unzipEntry(buffer, "xl/sharedStrings.xml"), sheetXml = await unzipEntry(buffer, "xl/worksheets/sheet1.xml");
  if (!sheetXml) throw new Error("Excel faylında ilk vərəq tapılmadı.");
  const stringsDoc = stringsXml ? new DOMParser().parseFromString(stringsXml, "text/xml") : null;
  const strings = stringsDoc ? [...stringsDoc.querySelectorAll("si")].map(item => [...item.querySelectorAll("t")].map(text => text.textContent || "").join("")) : [];
  const doc = new DOMParser().parseFromString(sheetXml, "text/xml");
  if (doc.querySelector("parsererror")) throw new Error("Excel vərəqinin XML məlumatı yanlışdır.");
  const matrix: string[][] = [];
  for (const sourceRow of doc.querySelectorAll("sheetData row")) {
    const row: string[] = [];
    for (const cell of sourceRow.querySelectorAll("c")) {
      const col = cell.getAttribute("r")?.match(/^[A-Z]+/)?.[0] || "A"; let index = 0;
      for (const ch of col) index = index * 26 + ch.charCodeAt(0) - 64;
      const type = cell.getAttribute("t"), raw = cell.querySelector("v")?.textContent || "";
      row[index - 1] = type === "s" ? strings[Number(raw)] || "" : type === "inlineStr" ? cell.querySelector("is")?.textContent || "" : raw;
    }
    matrix.push(row);
  }
  const headers = (matrix.shift() || []).map(header => header.trim());
  return { headers, rows: matrix.filter(values => values.some(Boolean)).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]))) };
}

function guess(header: string, key: string) {
  const patterns: Record<string, RegExp> = { name: /name|məhsul|ad/i, sku: /sku|kod/i, price: /price|qiymət/i, discountPrice: /discount|endirim/i, category: /category|kateqoriya/i, brand: /brand|brend/i, quantity: /quantity|stock|stok|miqdar/i, lowStockThreshold: /threshold|hədd/i, description: /description|təsvir/i, images: /images?|şəkil/i, variants: /variants?|variant/i };
  return patterns[key]?.test(header) || false;
}

export default function VendorImport({ storeId, endpointUrl, onImported }: { storeId: string; endpointUrl?: string; onImported?: () => Promise<void> | void }) {
  const [step, setStep] = useState(0), [fileName, setFileName] = useState(""), [headers, setHeaders] = useState<string[]>([]), [rows, setRows] = useState<Row[]>([]), [mapping, setMapping] = useState<Record<string, string>>({}), [mode, setMode] = useState<ImportMode>("create"), [checks, setChecks] = useState<Validation[]>([]), [message, setMessage] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const url = endpointUrl ?? `/api/vendor/${encodeURIComponent(storeId)}/imports`;

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    if (file.size < 1 || file.size > 10 * 1024 * 1024) { setError("Fayl 10 MB-dan böyük olmamalıdır."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const parsed = file.name.toLowerCase().endsWith(".xlsx") ? await parseXlsx(file) : parseCsv(await file.text());
      if (!parsed.headers.length || !parsed.rows.length) throw new Error("Faylda başlıqlar və məhsul sətirləri olmalıdır.");
      if (parsed.headers.length > 50) throw new Error("Faylda maksimum 50 sütun qəbul edilir.");
      if (new Set(parsed.headers.map(header => header.toLocaleLowerCase())).size !== parsed.headers.length) throw new Error("Faylda eyni adlı sütunlar təkrarlanmamalıdır.");
      if (parsed.rows.length > 1000) throw new Error("Bir idxalda maksimum 1000 sətir qəbul edilir.");
      setFileName(file.name); setHeaders(parsed.headers); setRows(parsed.rows);
      const initial: Record<string, string> = {};
      for (const key of Object.keys(fields)) initial[key] = parsed.headers.find(header => guess(header, key)) || "";
      setMapping(initial); setChecks([]); setStep(1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Fayl oxunmadı."); }
    finally { setBusy(false); }
  }

  async function validate() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "validate", mode, sourceName: fileName, mapping, rows }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Yoxlama tamamlanmadı.");
      setChecks(result.rows || []); setStep(2);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Yoxlama tamamlanmadı."); }
    finally { setBusy(false); }
  }

  async function importRows() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "import", mode, sourceName: fileName, mapping, rows }) });
      const result = await response.json();
      if (!response.ok && response.status !== 207) throw new Error(result.error || "İdxal bazaya yazılmadı.");
      const created = result.created ?? result.successCount ?? 0;
      const updated = result.updated ?? 0;
      const summary = `${created} yaradıldı${updated ? ` · ${updated} yeniləndi` : ""} · ${result.errorCount || 0} sətir xətası`;
      setMessage(summary); setChecks(result.rows || checks); setStep(3); await onImported?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "İdxal bazaya yazılmadı."); }
    finally { setBusy(false); }
  }

  function reset() { setStep(0); setFileName(""); setHeaders([]); setRows([]); setMapping({}); setMode("create"); setChecks([]); setMessage(""); setError(""); }
  const validCount = checks.filter(row => row.status !== "INVALID").length;
  const invalidCount = checks.filter(row => row.status === "INVALID").length;
  const badge = (status: string) => status === "VALID" ? "bg-emerald-50 text-emerald-800" : status === "WARNING" ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-800";

  return <section className="mt-5 rounded-2xl border border-[#e9e4da] bg-white p-5 sm:p-7"><div className="mb-5 grid grid-cols-4 gap-2 text-xs sm:text-sm">{["Yüklə", "Sütunlar", "Yoxlama", "Nəticə"].map((label, index) => <div key={label} className={`rounded-lg px-2 py-2 text-center ${step === index ? "bg-[#173c40] text-white" : "bg-[#f4f1ea] text-slate-500"}`}>{index + 1}. {label}</div>)}</div>
    {step === 0 && <div className="grid gap-3"><a className="w-fit text-sm font-semibold text-[#173c40] underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`} download="bagati-product-import-template.csv">CSV şablonunu yüklə</a><p className="text-xs text-slate-500">Məcburi sütunlar: name, price, category. Digərləri istəyə bağlıdır. Şəkillər HTTPS ünvanları ilə; variants isə ad, options, SKU, stok və qiymət sahələri olan JSON massivi kimi verilir.</p><label className="grid gap-2 text-sm">CSV və ya Excel (.xlsx) faylı<input className={input} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={event => void upload(event)}/><span className="text-xs text-slate-500">Maksimum 10 MB, 1000 sətir və 50 sütun. Yeni məhsullar idxaldan sonra qaralama qalır; mövcud məhsulun statusu dəyişmir.</span></label></div>}
    {step === 1 && <><p className="text-sm text-slate-600"><b>{fileName}</b> · {rows.length} sətir oxundu. Sütunları özünüz uyğunlaşdırın.</p><label className="mt-4 grid max-w-xl gap-1 text-sm">İdxal rejimi<select className={input} value={mode} onChange={event => setMode(event.target.value as ImportMode)}><option value="create">Yalnız yeni məhsullar əlavə et</option><option value="update">Mövcud SKU-ları yenilə</option><option value="mixed">Mövcud SKU-ları yenilə, yeniləri əlavə et</option></select></label><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(fields).map(([key, label]) => <label key={key} className="grid gap-1 text-sm">{label}{["name", "price", "category"].includes(key) && <span className="text-xs text-red-700">Tələb olunur</span>}<select className={input} value={mapping[key] || ""} onChange={event => setMapping(current => ({ ...current, [key]: event.target.value }))}><option value="">Uyğunlaşdırılmayıb</option>{headers.map((header, index) => <option key={`${header}-${index}`} value={header}>{header}</option>)}</select></label>)}</div><div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void validate()} className="min-h-11 rounded-xl bg-[#173c40] px-4 py-3 text-sm font-semibold text-white">{busy ? "Yoxlanılır…" : "Yoxla və önbaxış"}</button><button type="button" onClick={() => setStep(0)} className="min-h-11 rounded-xl border px-4 py-3 text-sm">Başqa fayl seç</button></div></>}
    {step === 2 && <><div className="flex flex-wrap justify-between gap-2 text-sm"><p>Önbaxış · {checks.length} sətir</p><p className="text-slate-600">{validCount} uyğun · {invalidCount} xətalı</p></div><div className="mt-3 max-h-[34rem] overflow-auto rounded-xl border"><table className="w-full min-w-[900px] text-left text-xs"><thead className="sticky top-0 bg-[#f8f7f4]"><tr>{["Sətir", "Vəziyyət", "Məhsul", "SKU", "Qiymət", "Endirim", "Kateqoriya", "Şəkillər / variantlar", "Yoxlama qeydləri"].map(column => <th key={column} className="p-3">{column}</th>)}</tr></thead><tbody>{checks.map(row => {const sourceRow=rows[row.index-2];const categoryColumn=mapping.category;return <tr key={row.index} className="border-t align-top"><td className="p-3">{row.index}</td><td className="p-3"><span className={`rounded-full px-2 py-1 ${badge(row.status)}`}>{row.status}</span></td><td className="max-w-40 p-3">{String(row.product.name || "")}</td><td className="p-3">{String(row.product.sku || "—")}</td><td className="p-3">{String(row.product.price || "")}</td><td className="p-3">{String(row.product.discountPrice || "—")}</td><td className="p-3">{String(categoryColumn ? sourceRow?.[categoryColumn] || "" : row.product.categoryId || "")}</td><td className="p-3">{Array.isArray(row.product.images)?row.product.images.length:0} şəkil · {Array.isArray(row.product.variants)?row.product.variants.length:0} variant</td><td className="p-3 text-red-800">{[...row.errors, ...row.warnings].join(" · ") || "—"}</td></tr>})}</tbody></table></div><p className="mt-3 text-xs text-slate-500">Yalnız uyğun və xəbərdarlıq statuslu sətirlər idxal edilir; xətalı sətirlər nəticə hesabatında qalır. Mövcud variantları yeniləmək məhsulun ayrıca redaktə səhifəsində aparılır. Hər sətir serverdə yenidən yoxlanır.</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={busy || validCount === 0} onClick={() => void importRows()} className="min-h-11 rounded-xl bg-[#173c40] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Bazaya yazılır…" : `${validCount} məhsulu idxal et`}</button><button type="button" onClick={() => setStep(1)} className="min-h-11 rounded-xl border px-4 py-3 text-sm">Sütunlara qayıt</button></div></>}
    {step === 3 && <div role="status"><h2 className="font-semibold">İdxal nəticəsi</h2><p className="mt-2 text-sm text-slate-600">{message}. Faktiki yazılan qeydlər import tarixçəsində göstərilir.</p><div className="mt-4 max-h-64 space-y-2 overflow-auto">{checks.filter(row => row.status === "INVALID").map(row => <p key={row.index} className="rounded-lg bg-red-50 p-3 text-sm text-red-800">Sətir {row.index}: {row.errors.join(" · ")}</p>)}</div><button type="button" onClick={reset} className="mt-4 min-h-11 rounded-xl border px-4 py-2.5 text-sm">Yeni fayl yüklə</button></div>}
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  </section>;
}
