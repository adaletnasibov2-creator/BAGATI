"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { chunkCatalogImportRows, offsetCatalogImportValidationRows } from "@/lib/catalog-import-client";
import { matchCatalogImagesToRows, parseCatalogImageArchive, type CatalogArchiveImage } from "@/lib/catalog-image-archive";

type Row = Record<string, string>;
type Validation = { index: number; status: "VALID" | "INVALID" | "WARNING"; errors: string[]; warnings: string[]; product: Record<string, unknown> };
type ImportMode = "create" | "update" | "mixed";
type ImportJobSummary = { id: string; sourceName: string; status: string; totalRows: number; processedRows: number; createdRows: number; updatedRows: number; skippedRows: number; failedRows: number; lastError?: string | null };
const importStatusLabels: Record<string, string> = { UPLOADING: "Fayl əlavə olunur", UPLOAD_FAILED: "Fayl əlavə edilmədi", QUEUED: "Növbədədir", PROCESSING: "Emal olunur", PAUSED: "Dayandırılıb", FAILED: "Xəta baş verdi", COMPLETED: "Tamamlandı", COMPLETED_WITH_ERRORS: "Xətalı sətirlər var", CANCELLED: "Ləğv edildi" };
const rowStatusLabels: Record<string, string> = { VALID: "Uyğundur", WARNING: "Yoxlayın", INVALID: "Xətalıdır" };
const fields: Record<string, string> = { name: "Məhsulun adı", sku: "Məhsul kodu (istəyə bağlı)", price: "Qiymət (AZN)", discountPrice: "Endirimli qiymət (AZN)", category: "Kateqoriya", brand: "Brend", quantity: "Anbar qalığı", lowStockThreshold: "Az stok xəbərdarlığı", description: "Məhsulun təsviri", images: "Şəkil ünvanları" };
const input = "w-full rounded-xl border border-[#ded9cf] bg-white px-3 py-2.5 text-sm";
const template = "\uFEFFMəhsulun adı,Məhsul kodu (istəyə bağlı),Məhsulun təsviri,Qiymət (AZN),Endirimli qiymət (AZN),Kateqoriya,Brend,Anbar qalığı,Az stok xəbərdarlığı,Şəkil ünvanları\r\nNümunə məhsul,,Məhsul haqqında qısa məlumat,10,,,,0,5,\r\n";

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
  const patterns: Record<string, RegExp> = { name: /name|məhsul|ad/i, sku: /sku|məhsul kodu|kod/i, price: /price|qiymət/i, discountPrice: /discount|endirim/i, category: /category|kateqoriya/i, brand: /brand|brend/i, quantity: /quantity|stock|stok|anbar|miqdar/i, lowStockThreshold: /threshold|hədd|xəbərdarlıq/i, description: /description|təsvir/i, images: /images?|şəkil/i, variants: /variants?|variant/i };
  return patterns[key]?.test(header) || false;
}

export default function VendorImport({ storeId, endpointUrl, assetEndpointUrl, onImported }: { storeId: string; endpointUrl?: string; assetEndpointUrl?: string; onImported?: () => Promise<void> | void }) {
  const [step, setStep] = useState(0), [fileName, setFileName] = useState(""), [fileSizeBytes, setFileSizeBytes] = useState(0), [sourceFormat, setSourceFormat] = useState<"csv" | "xlsx">("csv"), [headers, setHeaders] = useState<string[]>([]), [rows, setRows] = useState<Row[]>([]), [mapping, setMapping] = useState<Record<string, string>>({}), [mode, setMode] = useState<ImportMode>("create"), [checks, setChecks] = useState<Validation[]>([]), [message, setMessage] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [progress, setProgress] = useState(""), [jobs, setJobs] = useState<ImportJobSummary[]>([]), [completedJobId, setCompletedJobId] = useState(""), [imageArchive, setImageArchive] = useState<CatalogArchiveImage[]>([]);
  const activeJobRef = useRef("");
  const [imagePreviewUrls, setImagePreviewUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const previews = Object.fromEntries(imageArchive.map(image => [image.filename, URL.createObjectURL(image.file)]));
    setImagePreviewUrls(previews);
    return () => Object.values(previews).forEach(url => URL.revokeObjectURL(url));
  }, [imageArchive]);
  const requestedJobActionRef = useRef<{ jobId: string; action: "pause" | "cancel" } | null>(null);
  const url = endpointUrl ?? `/api/vendor/${encodeURIComponent(storeId)}/imports`;
  const jobUrl = endpointUrl ? null : `/api/vendor/${encodeURIComponent(storeId)}/imports/jobs`;
  const assetsUrl = assetEndpointUrl ?? (jobUrl ? `/api/vendor/${encodeURIComponent(storeId)}/assets` : null);

  async function refreshImportedProducts() {
    try { await onImported?.(); }
    catch { setError("İdxal tamamlandı, lakin məhsul siyahısını yeniləmək alınmadı. Səhifəni yeniləyin."); }
  }

  const refreshJobs = useCallback(async () => {
    if (!jobUrl) return;
    const response = await fetch(jobUrl, { cache: "no-store" });
    if (response.ok) setJobs((await response.json()).items || []);
  }, [jobUrl]);
  useEffect(() => { void refreshJobs(); }, [refreshJobs]);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    if (file.size < 1 || file.size > 10 * 1024 * 1024) { setError("Fayl 10 MB-dan böyük olmamalıdır."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const parsed = file.name.toLowerCase().endsWith(".xlsx") ? await parseXlsx(file) : parseCsv(await file.text());
      if (!parsed.headers.length || !parsed.rows.length) throw new Error("Faylda başlıqlar və məhsul sətirləri olmalıdır.");
      if (parsed.headers.length > 50) throw new Error("Faylda maksimum 50 sütun qəbul edilir.");
      if (new Set(parsed.headers.map(header => header.toLocaleLowerCase())).size !== parsed.headers.length) throw new Error("Faylda eyni adlı sütunlar təkrarlanmamalıdır.");
      if (parsed.rows.length > (jobUrl ? 100_000 : 1000)) throw new Error(jobUrl ? "Bir idxalda maksimum 100 000 sətir qəbul edilir." : "Admin idxalında maksimum 1000 sətir qəbul edilir.");
      if (jobUrl && parsed.rows.some(row => new TextEncoder().encode(JSON.stringify(row)).byteLength > 8 * 1024)) throw new Error("Hər sətir 8 KB-dan kiçik olmalıdır. Təsvir və ya variant məlumatlarını qısaldın.");
      setFileName(file.name); setHeaders(parsed.headers); setRows(parsed.rows);
      setFileSizeBytes(file.size); setSourceFormat(file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv");
      const initial: Record<string, string> = {};
      for (const key of Object.keys(fields)) initial[key] = parsed.headers.find(header => guess(header, key)) || "";
      setMapping(initial); setChecks([]); setStep(1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Fayl oxunmadı."); }
    finally { setBusy(false); }
  }

  async function uploadImageArchive(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const entries = await parseCatalogImageArchive(file);
      setImageArchive(entries);
      setMessage(`${entries.length} şəkil ZIP arxivindən oxundu. Fayllar məhsul kodu və ya təkrarlanmayan məhsul adı ilə uyğunlaşdırılacaq.`);
    } catch (reason) {
      setImageArchive([]);
      setError(reason instanceof Error ? archiveErrorMessage(reason.message) : "Şəkil arxivi oxunmadı.");
    } finally { setBusy(false); }
  }

  function archiveErrorMessage(code: string) {
    const messages: Record<string, string> = {
      IMAGE_ARCHIVE_SIZE_INVALID: "ZIP arxivi boşdur və ya 25 MB limitini keçir.",
      IMAGE_ARCHIVE_STRUCTURE_UNSUPPORTED: "ZIP formatı dəstəklənmir; bir diskli adi ZIP istifadə edin.",
      IMAGE_ARCHIVE_PATH_UNSAFE: "ZIP daxilində qovluq və ya təhlükəli fayl yolu var. Şəkilləri arxivin kökündə saxlayın.",
      IMAGE_ARCHIVE_FILENAME_INVALID: "Şəkil faylının adını məhsul kodu.jpg və ya məhsul adı.jpg formasında yazın.",
      IMAGE_ARCHIVE_DUPLICATE_FILENAME: "ZIP daxilində eyni adlı fayl təkrar olunur.",
      IMAGE_ARCHIVE_DUPLICATE_SKU_IMAGE_ORDER: "Eyni məhsul kodu və sıra nömrəsi üçün təkrar şəkil var.",
      IMAGE_ARCHIVE_TOTAL_UNPACKED_SIZE_EXCEEDED: "Açılmış şəkillərin ümumi həcmi 50 MB limitini keçir.",
      IMAGE_ARCHIVE_ENTRY_SIZE_OR_METHOD_INVALID: "ZIP-də dəstəklənməyən format və ya 5 MB-dan böyük şəkil var.",
      IMAGE_ARCHIVE_ENCRYPTED_UNSUPPORTED: "Şifrələnmiş ZIP arxivi dəstəklənmir.",
      IMAGE_ARCHIVE_LINK_UNSUPPORTED: "ZIP-də simvolik keçid olan fayl aşkarlanıb.",
      IMAGE_ARCHIVE_ENTRY_CORRUPT: "ZIP daxilində zədələnmiş şəkil var.",
      IMAGE_ARCHIVE_DECOMPRESSION_UNAVAILABLE: "Bu brauzerdə ZIP sıxılmasını açmaq mümkün deyil.",
    };
    return messages[code] || "Şəkil arxivi oxunmadı; ZIP quruluşunu yoxlayın.";
  }

  const imageMatches = matchCatalogImagesToRows(imageArchive, rows, mapping.sku, mapping.name);

  async function validate() {
    setBusy(true); setError(""); setMessage("");
    try {
      const resultRows: Validation[] = [];
      for (let offset = 0; offset < rows.length; offset += 100) {
        setProgress(`Yoxlanılır: ${Math.min(offset + 100, rows.length)} / ${rows.length}`);
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "validate", mode, sourceName: fileName, mapping, rows: rows.slice(offset, offset + 100) }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Yoxlama tamamlanmadı.");
        resultRows.push(...offsetCatalogImportValidationRows(result.rows || [], offset));
      }
      setChecks(resultRows); setStep(2);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Yoxlama tamamlanmadı."); }
    finally { setBusy(false); setProgress(""); }
  }

  async function runJob(jobId: string, status: string, sourceRows: Row[] = rows): Promise<string> {
    if (!jobUrl) return "FAILED";
    activeJobRef.current = jobId;
    let jobFinalized = status !== "UPLOADING";
    setBusy(true); setError(""); setMessage("");
    try {
      if (status === "UPLOADING") {
        const chunks = chunkCatalogImportRows(sourceRows, 50);
        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
          const chunk = chunks[chunkIndex];
          const offset = chunk[0]?.rowNumber - 1 || 0;
          setProgress(`Sətirlər göndərilir: ${Math.min(offset + chunk.length, sourceRows.length)} / ${sourceRows.length}`);
          const response = await fetch(`${jobUrl}/${encodeURIComponent(jobId)}/rows`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: chunk }) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Sətirlər saxlanmadı.");
          const requested = requestedJobActionRef.current;
          if (requested?.jobId === jobId) {
            const stopped = await fetch(`${jobUrl}/${encodeURIComponent(jobId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: requested.action }) });
            const stoppedResult = await stopped.json();
            if (!stopped.ok) throw new Error(stoppedResult.error || "Import action failed.");
            status = stoppedResult.job.status;
            requestedJobActionRef.current = null;
            break;
          }
        }
        if (status === "UPLOADING") {
        const finalized = await fetch(`${jobUrl}/${encodeURIComponent(jobId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "finalize" }) });
        const finalResult = await finalized.json();
        if (!finalized.ok) throw new Error(finalResult.error || "İdxal işi başladılmadı.");
        status = finalResult.job.status;
        jobFinalized = true;
        }
      }
      while (status === "QUEUED" || status === "PROCESSING") {
        const response = await fetch(`${jobUrl}/${encodeURIComponent(jobId)}/process`, { method: "POST" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "İdxal hissəsini emal etmək mümkün olmadı.");
        status = result.job.status;
        setProgress(`Məhsullar yazılır: ${result.job.processedRows} / ${result.job.totalRows}`);
        const requested = requestedJobActionRef.current;
        if (requested?.jobId === jobId && (status === "QUEUED" || status === "PROCESSING")) {
          const stopped = await fetch(`${jobUrl}/${encodeURIComponent(jobId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: requested.action }) });
          const stoppedResult = await stopped.json();
          if (!stopped.ok) throw new Error(stoppedResult.error || "Import action failed.");
          status = stoppedResult.job.status;
          requestedJobActionRef.current = null;
        }
      }
      const response = await fetch(`${jobUrl}/${encodeURIComponent(jobId)}`, { cache: "no-store" });
      const result = await response.json();
      if (response.ok) {
        const job: ImportJobSummary = result.job;
        if (["COMPLETED", "COMPLETED_WITH_ERRORS"].includes(job.status)) {
          setMessage(`${job.createdRows} yaradıldı · ${job.updatedRows} yeniləndi · ${job.skippedRows} keçildi · ${job.failedRows} xətalı sətir`);
          setCompletedJobId(job.id); setStep(3); await refreshImportedProducts();
        } else if (job.status === "PAUSED") {
          setMessage("İdxal dayandırılıb. Tarixçədən davam etdirə bilərsiniz.");
        } else if (job.status === "CANCELLED") {
          setMessage("İdxal ləğv edildi. Artıq yazılmış sətirlər saxlanılıb.");
        } else {
          throw new Error(job.lastError || "İdxal işi tamamlanmadı.");
        }
      }
      await refreshJobs();
      return status;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Import processing failed."); return jobFinalized ? "FAILED" : "UPLOAD_FAILED"; }
    finally { if (activeJobRef.current === jobId) activeJobRef.current = ""; setBusy(false); setProgress(""); }
  }

  function requestJobAction(jobId: string, action: "pause" | "cancel") {
    if (activeJobRef.current === jobId) {
      requestedJobActionRef.current = { jobId, action };
      setProgress(action === "pause" ? "Cari hissə tamamlandıqdan sonra idxal dayandırılacaq…" : "Cari hissə tamamlandıqdan sonra qalan sətirlər ləğv ediləcək…");
      return;
    }
    void updateJob(jobId, action);
  }

  async function startJob() {
    if (!jobUrl) return importRows();
    setBusy(true); setError(""); setProgress("İdxal işi yaradılır…");
    const uploadedUrls: string[] = [];
    let createdJobId = "";
    try {
      if (imageArchive.length && (imageMatches.unmatched.length || imageMatches.duplicates.length)) {
        throw new Error(imageMatches.duplicates.length ? "Təkrar məhsul kodu və ya adı var; şəkil uyğunluğu qeyri-müəyyəndir." : `${imageMatches.unmatched.length} ZIP şəkli cədvəldəki məhsul kodu və ya adı ilə uyğunlaşmır.`);
      }
      if (imageArchive.length && !mapping.sku && !mapping.name) throw new Error("ZIP şəkillərini uyğunlaşdırmaq üçün məhsul kodu və ya məhsul adı sütununu seçin.");
      const imageUrlsByRow = new Map<number, { order: number; url: string }[]>();
      for (let index = 0; index < imageMatches.matches.length; index++) {
        const image = imageMatches.matches[index];
        setProgress(`Şəkillər yüklənir: ${index + 1} / ${imageMatches.matches.length}`);
        const form = new FormData(); form.set("file", image.file);
        const uploaded = await fetch(`/api/vendor/${encodeURIComponent(storeId)}/assets`, { method: "POST", body: form });
        const result = await uploaded.json();
        if (!uploaded.ok || typeof result.asset?.url !== "string") throw new Error(result.error || `${image.filename}: şəkil yüklənmədi.`);
        uploadedUrls.push(result.asset.url);
        imageUrlsByRow.set(image.rowIndex, [...(imageUrlsByRow.get(image.rowIndex) || []), { order: image.order, url: result.asset.url }]);
      }
      const imageColumn = mapping.images || "__bagati_import_image_urls";
      const jobMapping = imageArchive.length ? { ...mapping, images: imageColumn } : mapping;
      const jobRows = imageArchive.length ? rows.map((row, index) => {
        const urls = (imageUrlsByRow.get(index) || []).sort((left, right) => left.order - right.order).map((item) => item.url);
        const prior = mapping.images ? String(row[imageColumn] || "") : "";
        return { ...row, [imageColumn]: [prior, ...urls].filter(Boolean).join(",") };
      }) : rows;
      const overLimit = imageUrlsByRow.size && [...imageUrlsByRow.values()].some((images) => images.length > 12);
      if (overLimit) throw new Error("Bir məhsula ən çox 12 şəkil bağlamaq olar.");
      const checksumBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(rows)));
      const sourceChecksum = Array.from(new Uint8Array(checksumBytes), byte => byte.toString(16).padStart(2, "0")).join("");
      const created = await fetch(jobUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceName: fileName, sourceFormat, sourceSizeBytes: fileSizeBytes, sourceChecksum, mode, mapping: jobMapping, chunkSize: 50 }) });
      const createdResult = await created.json();
      if (!created.ok) throw new Error(createdResult.error || "İdxal işi yaradılmadı.");
      createdJobId = createdResult.job.id;
      await refreshJobs();
      const finalStatus = await runJob(createdJobId, "UPLOADING", jobRows);
      if (finalStatus === "UPLOAD_FAILED") await fetch(`${jobUrl}/${encodeURIComponent(createdJobId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) }).catch(() => undefined);
      if (["COMPLETED", "COMPLETED_WITH_ERRORS", "CANCELLED", "UPLOAD_FAILED"].includes(finalStatus)) {
        for (const url of uploadedUrls) await fetch(`/api/vendor/${encodeURIComponent(storeId)}/assets`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }).catch(() => undefined);
      }
    } catch (reason) {
      if (createdJobId) await fetch(`${jobUrl}/${encodeURIComponent(createdJobId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) }).catch(() => undefined);
      for (const url of uploadedUrls) await fetch(`/api/vendor/${encodeURIComponent(storeId)}/assets`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }).catch(() => undefined);
      setError(reason instanceof Error ? reason.message : "İdxal başlamadı.");
    } finally { setBusy(false); setProgress(""); }
  }

  async function updateJob(jobId: string, action: "pause" | "resume" | "cancel" | "retry_failed") {
    if (!jobUrl) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`${jobUrl}/${encodeURIComponent(jobId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "İdxal işi yenilənmədi.");
      if (action === "resume" || action === "retry_failed") await runJob(jobId, result.job.status);
      else await refreshJobs();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "İdxal işi yenilənmədi."); }
    finally { setBusy(false); }
  }

  async function downloadErrorReport(jobId: string) {
    if (!jobUrl) return;
    const failures: { rowNumber: number; errors: unknown }[] = [];
    let after: number | null = null;
    do {
      const query = new URLSearchParams({ take: "100" }); if (after) query.set("after", String(after));
      const response = await fetch(`${jobUrl}/${encodeURIComponent(jobId)}?${query.toString()}`, { cache: "no-store" });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Xəta hesabatı yüklənmədi.");
      for (const row of result.rows || []) if (row.status === "FAILED") failures.push({ rowNumber: row.rowNumber + 1, errors: row.errors });
      after = result.nextAfter;
    } while (after !== null);
    const csv = ["row,errors", ...failures.map(item => `${item.rowNumber},"${JSON.stringify(item.errors).replaceAll('"', '""')}"`)].join("\r\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" })); link.download = "bagati-import-errors.csv"; link.click(); URL.revokeObjectURL(link.href);
  }

  async function importRows() {
    setBusy(true); setError(""); setMessage("");
    const uploadedUrls: string[] = [];
    try {
      let importRowsData = rows;
      let importMapping = mapping;
      if (imageArchive.length) {
        if (!assetsUrl) throw new Error("ZIP şəkillərini bu idxalda yükləmək mümkün deyil.");
        if (!mapping.sku && !mapping.name) throw new Error("ZIP şəkillərini uyğunlaşdırmaq üçün məhsul kodu və ya məhsul adı sütununu seçin.");
        const imageMatches = matchCatalogImagesToRows(imageArchive, rows, mapping.sku, mapping.name);
        if (imageMatches.duplicates.length || imageMatches.unmatched.length) throw new Error(imageMatches.duplicates.length ? "Təkrar məhsul kodu və ya adı var; şəkil uyğunluğu qeyri-müəyyəndir." : imageMatches.unmatched.length + " ZIP şəkli cədvəldəki məhsul kodu və ya adı ilə uyğunlaşmır.");
        const imageUrlsByRow = new Map<number, { order: number; url: string }[]>();
        for (let index = 0; index < imageMatches.matches.length; index++) {
          const image = imageMatches.matches[index];
          setProgress("Şəkillər yüklənir: " + (index + 1) + " / " + imageMatches.matches.length);
          const form = new FormData(); form.set("file", image.file);
          const uploaded = await fetch(assetsUrl, { method: "POST", body: form });
          const result = await uploaded.json();
          if (!uploaded.ok || typeof result.asset?.url !== "string") throw new Error(result.error || image.filename + ": şəkil yüklənmədi.");
          uploadedUrls.push(result.asset.url);
          imageUrlsByRow.set(image.rowIndex, [...(imageUrlsByRow.get(image.rowIndex) || []), { order: image.order, url: result.asset.url }]);
        }
        if ([...imageUrlsByRow.values()].some((images) => images.length > 12)) throw new Error("Bir məhsula ən çox 12 şəkil bağlamaq olar.");
        const imageColumn = mapping.images || "__bagati_import_image_urls";
        importMapping = { ...mapping, images: imageColumn };
        importRowsData = rows.map((row, index) => {
          const urls = (imageUrlsByRow.get(index) || []).sort((left, right) => left.order - right.order).map((item) => item.url);
          const prior = mapping.images ? String(row[imageColumn] || "") : "";
          return { ...row, [imageColumn]: [prior, ...urls].filter(Boolean).join(",") };
        });
      }
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "import", mode, sourceName: fileName, mapping: importMapping, rows: importRowsData }) });
      const result = await response.json();
      if (!response.ok && response.status !== 207) throw new Error(result.error || "İdxal bazaya yazılmadı.");
      const created = result.created ?? result.successCount ?? 0;
      const updated = result.updated ?? 0;
      setMessage(String(created) + " yaradıldı" + (updated ? " · " + updated + " yeniləndi" : "") + " · " + (result.errorCount || 0) + " sətir xətası");
      setChecks(result.rows || checks); setStep(3); await refreshImportedProducts();
      // The API refuses to delete any asset that is now referenced. This removes
      // only unreferenced uploads (for example, images on rejected import rows).
      for (const assetUrl of uploadedUrls) await fetch(assetsUrl!, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: assetUrl }) }).catch(() => undefined);
    } catch (reason) {
      for (const assetUrl of uploadedUrls) if (assetsUrl) await fetch(assetsUrl, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: assetUrl }) }).catch(() => undefined);
      setError(reason instanceof Error ? reason.message : "İdxal bazaya yazılmadı.");
    } finally { setBusy(false); setProgress(""); }
  }

  function reset() { setStep(0); setFileName(""); setFileSizeBytes(0); setImageArchive([]); setCompletedJobId(""); setHeaders([]); setRows([]); setMapping({}); setMode("create"); setChecks([]); setMessage(""); setError(""); }
  const validCount = checks.filter(row => row.status !== "INVALID").length;
  const invalidCount = checks.filter(row => row.status === "INVALID").length;
  const badge = (status: string) => status === "VALID" ? "bg-emerald-50 text-emerald-800" : status === "WARNING" ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-800";

  return <section className="mt-5 rounded-2xl border border-[#e9e4da] bg-white p-5 sm:p-7"><div className="mb-5 grid grid-cols-4 gap-2 text-xs sm:text-sm">{["Yüklə", "Sütunlar", "Yoxlama", "Nəticə"].map((label, index) => <div key={label} className={`rounded-lg px-2 py-2 text-center ${step === index ? "bg-[#173c40] text-white" : "bg-[#f4f1ea] text-slate-500"}`}>{index + 1}. {label}</div>)}</div>
    {step === 0 && <div className="grid gap-3"><a className="w-fit text-sm font-semibold text-[#173c40] underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`} download="bagati-product-import-template.csv">CSV şablonunu yüklə</a><p className="text-xs text-slate-500">Məcburi sütunlar məhsulun adı, qiyməti və kateqoriyasıdır. Şablonda bir nümunə sətri var: onu öz məlumatlarınızla əvəz edin. Məhsul kodunu boş saxlasanız, sistem özü yaradacaq. Seçimlər (məsələn, rəng və ölçü) məhsul yaradıldıqdan sonra onun redaktə səhifəsində əlavə olunur. Şəkil ünvanları HTTPS ilə başlamalıdır.</p><label className="grid gap-2 text-sm">CSV və ya Excel (.xlsx) faylı<input className={input} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={event => void upload(event)}/><span className="text-xs text-slate-500">Maksimum 10 MB, {jobUrl ? "100 000" : "1000"} sətir və 50 sütun. Yeni məhsullar idxaldan sonra qaralama qalır; mövcud məhsulun statusu dəyişmir.</span></label>{assetsUrl && <label className="grid gap-2 text-sm">Məhsul kodu və ya adı ilə uyğunlaşdırmaq üçün ZIP şəkil arxivi<input className={input} type="file" accept=".zip,application/zip" disabled={busy} onChange={event => void uploadImageArchive(event)}/><span className="text-xs text-slate-500">Fayl adını məhsul kodu.jpg və ya cədvəldə təkrarlanmayan məhsul adı.jpg yazın. Əlavə şəkillər üçün __2, __3 və s. əlavə edin. ZIP maksimum 25 MB və 200 şəkildir; açıldıqda maksimum 50 MB, hər şəkil maksimum 5 MB ola bilər.</span>{imageArchive.length > 0 && <span role="status" className="text-xs text-emerald-800">{imageArchive.length} &#351;&#601;kil oxundu.</span>}</label>}</div>}
    {step === 1 && <><p className="text-sm text-slate-600"><b>{fileName}</b> · {rows.length} sətir oxundu. Sütunları özünüz uyğunlaşdırın.</p><label className="mt-4 grid max-w-xl gap-1 text-sm">İdxal rejimi<select className={input} value={mode} onChange={event => setMode(event.target.value as ImportMode)}><option value="create">Yalnız yeni məhsullar əlavə et</option><option value="update">Mövcud məhsulları məhsul koduna görə yenilə</option><option value="mixed">Mövcud məhsulları məhsul koduna görə yenilə, yenilərini əlavə et</option></select></label><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(fields).map(([key, label]) => <label key={key} className="grid gap-1 text-sm">{label}{["name", "price", "category"].includes(key) && <span className="text-xs text-red-700">Tələb olunur</span>}<select className={input} value={mapping[key] || ""} onChange={event => setMapping(current => ({ ...current, [key]: event.target.value }))}><option value="">Uyğunlaşdırılmayıb</option>{headers.map((header, index) => <option key={`${header}-${index}`} value={header}>{header}</option>)}</select></label>)}</div>{imageArchive.length > 0 && <div className="rounded-xl bg-[#f8f7f4] p-3 text-sm"><p className="font-medium">ZIP &#351;&#601;kil uy&#287;unlu&#287;u</p><p className="mt-1 text-xs text-slate-600">Məhsul kodu və ya adı seçildikdən sonra {imageMatches.matches.length} &#351;&#601;kil uy&#287;unla&#351;&#305;b; {imageMatches.unmatched.length} uy&#287;un olmayan fayl, {imageMatches.duplicates.length} təkrar uyğunluq var.</p>{imageMatches.matches.slice(0, 20).map(image => <p key={image.filename} className="mt-1 text-xs">{image.filename} &#8594; {rows[image.rowIndex]?.[mapping.sku || mapping.name] || "Məhsul"}</p>)}</div>}<div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => void validate()} className="min-h-11 rounded-xl bg-[#173c40] px-4 py-3 text-sm font-semibold text-white">{busy ? "Yoxlanılır…" : "Yoxla və önbaxış"}</button><button type="button" onClick={() => setStep(0)} className="min-h-11 rounded-xl border px-4 py-3 text-sm">Başqa fayl seç</button></div></>}
    {step === 2 && <><div className="flex flex-wrap justify-between gap-2 text-sm"><p>Önbaxış · {checks.length} sətir</p><p className="text-slate-600">{validCount} uyğun · {invalidCount} xətalı</p></div><div className="mt-3 max-h-[34rem] overflow-auto rounded-xl border"><table className="w-full min-w-[900px] text-left text-xs"><thead className="sticky top-0 bg-[#f8f7f4]"><tr>{["Sətir", "Vəziyyət", "Məhsul", "Məhsul kodu", "Qiymət", "Endirim", "Kateqoriya", "Şəkillər / variantlar", "Yoxlama qeydləri"].map(column => <th key={column} className="p-3">{column}</th>)}</tr></thead><tbody>{checks.slice(0, 200).map(row => {const sourceRow=rows[row.index-2];const categoryColumn=mapping.category;const zippedImages=imageMatches.matches.filter(image=>image.rowIndex===row.index-2);return <tr key={row.index} className="border-t align-top"><td className="p-3">{row.index}</td><td className="p-3"><span className={`rounded-full px-2 py-1 ${badge(row.status)}`}>{rowStatusLabels[row.status]}</span></td><td className="max-w-40 p-3">{String(row.product.name || "")}</td><td className="p-3">{String(row.product.sku || "—")}</td><td className="p-3">{String(row.product.price || "")}</td><td className="p-3">{String(row.product.discountPrice || "—")}</td><td className="p-3">{String(categoryColumn ? sourceRow?.[categoryColumn] || "" : row.product.categoryId || "")}</td><td className="p-3">{(() => { const imageUrl = zippedImages[0] ? imagePreviewUrls[zippedImages[0].filename] : String(Array.isArray(row.product.images) ? row.product.images[0] || "" : ""); const imageCount = (Array.isArray(row.product.images) ? row.product.images.length : 0) + zippedImages.length; const choices = Array.isArray(row.product.variants) ? row.product.variants.length : 0; return <div className="flex min-w-36 items-center gap-2">{imageUrl && <Image src={imageUrl} alt="Məhsulun əsas şəkli" width={48} height={48} unoptimized className="h-12 w-12 rounded-lg border object-cover"/>}<span>{imageCount} şəkil · {choices} seçim</span></div>; })()}{zippedImages.length>0&&<span className="mt-1 block text-slate-500">{zippedImages.map(image=>image.filename).join(", ")}</span>}</td><td className="p-3 text-red-800">{[...row.errors, ...row.warnings].join(" · ") || "—"}</td></tr>})}</tbody></table></div>{checks.length > 200 && <p className="mt-2 text-xs text-slate-500">İlkin baxışda ilk 200 sətir göstərilir; bütün {checks.length} sətir yoxlanılıb.</p>}<p className="mt-3 text-xs text-slate-500">Yalnız uyğun və xəbərdarlıq statuslu sətirlər idxal edilir; xətalı sətirlər nəticə hesabatında qalır. Mövcud variantları yeniləmək məhsulun ayrıca redaktə səhifəsində aparılır. Hər sətir serverdə yenidən yoxlanır.</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={busy || validCount === 0 || imageMatches.unmatched.length > 0 || imageMatches.duplicates.length > 0} onClick={() => void startJob()} className="min-h-11 rounded-xl bg-[#173c40] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Bazaya yazılır…" : `${validCount} məhsulu idxal et`}</button><button type="button" onClick={() => setStep(1)} className="min-h-11 rounded-xl border px-4 py-3 text-sm">Sütunlara qayıt</button></div></>}
    {step === 3 && <div role="status"><h2 className="font-semibold">İdxal nəticəsi</h2><p className="mt-2 text-sm text-slate-600">{message}. Faktiki yazılan qeydlər import tarixçəsində göstərilir.</p><div className="mt-4 max-h-64 space-y-2 overflow-auto">{checks.filter(row => row.status === "INVALID").map(row => <p key={row.index} className="rounded-lg bg-red-50 p-3 text-sm text-red-800">Sətir {row.index}: {row.errors.join(" · ")}</p>)}</div><button type="button" onClick={reset} className="mt-4 min-h-11 rounded-xl border px-4 py-2.5 text-sm">Yeni fayl yüklə</button></div>}
    {progress && <p role="status" aria-live="polite" className="mt-4 rounded-xl bg-[#f8f7f4] p-3 text-sm text-slate-700">{progress}</p>}
    {step === 3 && completedJobId && jobUrl && <button type="button" onClick={() => void downloadErrorReport(completedJobId)} className="mt-3 min-h-11 rounded-xl border px-4 py-2.5 text-sm">Xətalı sətirlərin hesabatını yüklə</button>}
    {jobUrl && jobs.length > 0 && <div className="mt-6 border-t border-[#eeeae2] pt-5"><h3 className="font-semibold">Son idxal işləri</h3><div className="mt-3 space-y-2">{jobs.map(job => <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f8f7f4] p-3 text-sm"><div className="min-w-0"><p className="truncate font-medium">{job.sourceName}</p><p className="text-xs text-slate-500">{importStatusLabels[job.status] || "Vəziyyət məlum deyil"} · {job.processedRows}/{job.totalRows} · {job.failedRows} xəta</p>{job.lastError && <p className="text-xs text-red-700">{job.lastError}</p>}</div><div className="flex flex-wrap gap-2">{["UPLOADING", "QUEUED", "PROCESSING"].includes(job.status) && <button type="button" disabled={busy && activeJobRef.current !== job.id} onClick={() => requestJobAction(job.id, job.status === "UPLOADING" ? "cancel" : "pause")} className="rounded-lg border px-3 py-2 text-xs">{job.status === "UPLOADING" ? "Ləğv et" : "Dayandır"}</button>}{["PAUSED", "FAILED"].includes(job.status) && <button type="button" disabled={busy} onClick={() => void updateJob(job.id, "resume")} className="rounded-lg border px-3 py-2 text-xs">Davam et</button>}{["FAILED", "COMPLETED_WITH_ERRORS"].includes(job.status) && <button type="button" disabled={busy} onClick={() => void updateJob(job.id, "retry_failed")} className="rounded-lg border px-3 py-2 text-xs">Xətaları yenidən yoxla</button>}{["COMPLETED", "COMPLETED_WITH_ERRORS"].includes(job.status) && <button type="button" disabled={busy} onClick={() => void downloadErrorReport(job.id)} className="rounded-lg border px-3 py-2 text-xs">Xəta hesabatı</button>}</div></div>)}</div></div>}
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  </section>;
}
