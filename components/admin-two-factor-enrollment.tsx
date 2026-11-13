"use client";

import { FormEvent, useState } from "react";
import { Copy, Download, KeyRound, ShieldCheck } from "lucide-react";

type Setup = { qrSvg: string; manualKey: string };
type Props = {
  /** "login": forced enrollment before any session exists; "settings": optional enrollment from the security page. */
  mode: "login" | "settings";
  onFinished: () => void;
};

const input = "w-full rounded-xl border border-[#ded9cf] px-4 py-3 text-center font-mono text-lg tracking-[.3em] outline-none focus:border-[#bd9a5e]";

export default function AdminTwoFactorEnrollment({ mode, onFinished }: Props) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function post(path: string, body: unknown) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Əməliyyat alınmadı.");
    return data;
  }

  async function start() {
    setBusy(true); setError("");
    try { setSetup(await post("/api/admin/2fa/setup", {})); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Əməliyyat alınmadı."); }
    finally { setBusy(false); }
  }

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    try { setCodes((await post("/api/admin/2fa/activate", { code })).recoveryCodes); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Əməliyyat alınmadı."); }
    finally { setBusy(false); }
  }

  function download() {
    if (!codes) return;
    const text = `BAGATI admin bərpa kodları\nHər kod yalnız bir dəfə istifadə olunur.\n\n${codes.join("\n")}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "bagati-admin-berpa-kodlari.txt";
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  async function copy() {
    if (!codes) return;
    try { await navigator.clipboard.writeText(codes.join("\n")); setCopied(true); } catch { setCopied(false); }
  }

  if (codes) {
    return <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
        <ShieldCheck size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
        <p>İki mərhələli təsdiq aktivləşdirildi. {mode === "settings" ? "Digər sessiyalar bağlandı." : ""}</p>
      </div>
      <div>
        <h3 className="font-semibold text-[#0b1726]">Bərpa kodları</h3>
        <p className="mt-1 text-sm text-slate-600">Bu kodlar yalnız indi göstərilir. Telefonunuz əlçatan olmadıqda hər kod bir dəfə girişə imkan verir. Onları təhlükəsiz yerdə saxlayın.</p>
      </div>
      <ol className="grid grid-cols-1 gap-2 rounded-xl bg-[#f8f7f4] p-4 font-mono text-sm sm:grid-cols-2" aria-label="Bərpa kodları">
        {codes.map((code) => <li key={code} className="rounded-lg bg-white px-3 py-2 text-center tracking-wider">{code}</li>)}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={download} className="inline-flex items-center gap-2 rounded-xl border border-[#ded9cf] bg-white px-4 py-2.5 text-sm font-semibold"><Download size={16} aria-hidden="true" />Yüklə (.txt)</button>
        <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-2 rounded-xl border border-[#ded9cf] bg-white px-4 py-2.5 text-sm font-semibold"><Copy size={16} aria-hidden="true" />{copied ? "Kopyalandı" : "Kopyala"}</button>
      </div>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} className="mt-1 h-4 w-4" />Bərpa kodlarını təhlükəsiz yerdə saxladım.</label>
      <button type="button" disabled={!saved} onClick={onFinished} className="w-full rounded-xl bg-[#0b1726] px-4 py-3 font-semibold text-white disabled:opacity-50 sm:w-auto">{mode === "login" ? "Admin panelinə keç" : "Hazırdır"}</button>
    </div>;
  }

  if (!setup) {
    return <div className="space-y-4">
      <p className="text-sm leading-6 text-slate-600">Google Authenticator, Microsoft Authenticator və ya oxşar tətbiqdə QR kodu skan edin. Sonra tətbiqin göstərdiyi 6 rəqəmli kodu daxil edin.</p>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button type="button" disabled={busy} onClick={() => void start()} className="inline-flex items-center gap-2 rounded-xl bg-[#0b1726] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"><KeyRound size={16} aria-hidden="true" />{busy ? "Hazırlanır…" : "QR kodu yarat"}</button>
    </div>;
  }

  return <form onSubmit={activate} className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-[200px_1fr] sm:items-start">
      {/* SVG is generated on our server from the otpauth URI; it contains only path data. */}
      <div className="mx-auto w-[200px] rounded-xl border border-[#e7e3d9] bg-white p-2" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
      <div className="min-w-0 space-y-2 text-sm">
        <p className="text-slate-600">QR kodu skan edə bilmirsinizsə, bu açarı tətbiqə əl ilə daxil edin (növ: vaxta əsaslanan):</p>
        <p className="break-all rounded-lg bg-[#f8f7f4] px-3 py-2 font-mono text-sm tracking-wide" aria-label="Əl ilə daxil ediləcək açar">{setup.manualKey}</p>
        <p className="text-xs text-slate-500">Açarı heç kimlə paylaşmayın. Bu səhifəni bağlasanız, yeni QR kod yaradın.</p>
      </div>
    </div>
    <label className="grid gap-1.5 text-sm font-medium">Tətbiqdəki 6 rəqəmli kod<input className={input} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus /></label>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <button disabled={busy} className="w-full rounded-xl bg-[#0b1726] px-4 py-3 font-semibold text-white disabled:opacity-50 sm:w-auto sm:px-6">{busy ? "Yoxlanılır…" : "Təsdiqlə və aktivləşdir"}</button>
  </form>;
}
