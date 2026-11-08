import Link from "next/link";
import type { GoogleOAuthIntent, GoogleOAuthMode } from "@/lib/google-oauth";
import { loginPortalPath } from "@/lib/login-portal";

export function googleOAuthMessage(code?: string, _intent: GoogleOAuthIntent = "customer", portal?: string | null) {
  const portalPath = loginPortalPath(portal);
  if (code === "link-pending" && portalPath && portal !== "admin") {
    const place = portal === "vendor" ? "satıcı girişindən" : "müştəri girişindən";
    return `Təsdiqlənmiş Google e-poçtu ${place} açılan BAGATI hesabına uyğundur. Hesablar avtomatik birləşdirilmir. Google kimliyini bağlamaq üçün həmin girişdə BAGATI şifrənizlə daxil olun.`;
  }
  if (code === "account-exists" && portal === "admin") {
    return "Təsdiqlənmiş Google e-poçtu admin hesabına aiddir. Hesablar avtomatik birləşdirilmir. Admin hesablarına Google bağlama dəstəklənmir. Admin girişindən BAGATI şifrənizlə daxil olun.";
  }
  if (code === "account-exists" && portalPath) {
    const place = portal === "vendor" ? "satıcı girişindən" : portal === "admin" ? "admin girişindən" : "müştəri girişindən";
    return `Təsdiqlənmiş Google e-poçtu ${place} açılan BAGATI hesabına aiddir. Hesablar avtomatik birləşdirilmir. Həmin girişdə BAGATI şifrənizlə daxil olun.`;
  }
  if (code === "wrong-role" && portalPath) {
    const place = portal === "vendor" ? "satıcı girişindən" : portal === "admin" ? "admin girişindən" : "müştəri girişindən";
    return `Bu Google hesabı ${place} açılan BAGATI hesabına bağlıdır. Uyğun giriş bölməsindən daxil olun.`;
  }
  switch (code) {
    case "unavailable": return "Google girişi serverdə konfiqurasiya edilməyib.";
    case "account-exists": return "Təsdiqlənmiş Google e-poçtu ilə BAGATI hesabı tapıldı. Hesablar avtomatik birləşdirilmir. Mövcud hesabınıza uyğun giriş bölməsini seçin.";
    case "not-registered": return "Bu Google e-poçtu ilə BAGATI hesabı tapılmadı. Qeydiyyat səhifəsindən hesab yaradın.";
    case "wrong-role": return "Bu Google hesabı başqa BAGATI roluna bağlıdır. Uyğun hesab bölməsindən daxil olun.";
    case "cancelled": return "Google girişi ləğv edildi.";
    case "invalid": return "Google giriş sorğusu etibarsızdır və ya vaxtı bitib. Yenidən cəhd edin.";
    case "failed": return "Google ilə girişi tamamlamaq mümkün olmadı. Yenidən cəhd edin.";
    case "linked": return "Google hesabı BAGATI hesabınıza təhlükəsiz şəkildə bağlandı.";
    case "link-auth-required": return "Hesabları bağlamaq üçün əvvəlcə uyğun BAGATI hesabına daxil olun.";
    case "link-email-mismatch": return "Google hesabının təsdiqlənmiş e-poçtu BAGATI hesabınızın e-poçtu ilə eyni olmalıdır.";
    case "link-conflict": return "Bu Google kimliyi artıq başqa BAGATI hesabına bağlıdır. Bağlantı yaradılmadı.";
    case "conflict": return "Bu Google kimliyi artıq başqa BAGATI hesabına bağlıdır. Bağlantı yaradılmadı.";
    case "link-pending": return "Təsdiqlənmiş Google e-poçtu ilə BAGATI hesabı tapıldı. Hesablar avtomatik birləşdirilmir. Uyğun girişdə BAGATI şifrənizlə daxil olun ki, Google kimliyi yalnız həmin hesaba bağlansın.";
    case "link-expired": return "Google bağlantı sorğusunun vaxtı bitib. Yenidən Google ilə davam edin.";
    case "expired": return "Google bağlantı sorğusunun vaxtı bitib. Yenidən Google ilə davam edin.";
    case "link-reused": return "Bu Google bağlantı sorğusu artıq istifadə olunub. Yenidən Google ilə davam edin.";
    case "reused": return "Bu Google bağlantı sorğusu artıq istifadə olunub. Yenidən Google ilə davam edin.";
    case "link-mismatch": return "Daxil olduğunuz hesab bu Google bağlantısı üçün uyğun deyil. Google kimliyi bağlanmadı.";
    case "mismatch": return "Daxil olduğunuz hesab bu Google bağlantısı üçün uyğun deyil. Google kimliyi bağlanmadı.";
    case "unlinked": return "Google bağlantısı silindi. Hesaba BAGATI şifrənizlə daxil ola bilərsiniz.";
    case "unlink-blocked": return "Google bağlantısını silmək mümkün deyil, çünki hesabda başqa giriş üsulu yoxdur.";
    default: return "";
  }
}

export function GoogleOAuthButton({ intent, mode, nextPath, errorCode, portal }: {
  intent: GoogleOAuthIntent;
  mode: GoogleOAuthMode;
  nextPath?: string;
  errorCode?: string;
  portal?: string | null;
}) {
  const query = new URLSearchParams({ intent, mode });
  if (nextPath) query.set("next", nextPath);
  const error = googleOAuthMessage(errorCode, intent, portal);
  const portalChoice = errorCode === "account-exists" || errorCode === "wrong-role" || errorCode === "link-pending";
  const matchedPortal = loginPortalPath(portal);
  return <div className="mt-7 space-y-3">
    {error && <div role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <p>{error}</p>
      {portalChoice && <>
        <nav aria-label="Hesab növünə uyğun giriş" className="mt-3 flex flex-wrap gap-x-4 gap-y-2 font-semibold underline">
          {matchedPortal === "/vendor/login" && intent !== "vendor" && <Link href="/vendor/login">Satıcı girişinə keç</Link>}
          {matchedPortal === "/login" && intent !== "customer" && <Link href="/login">Müştəri girişinə keç</Link>}
          {matchedPortal === "/admin/login" && <Link href="/admin/login">Admin girişinə keç</Link>}
          {!matchedPortal && <>
            <Link href="/login">Müştəri girişi</Link>
            <Link href="/vendor/login">Satıcı girişi</Link>
            <Link href="/admin/login">Admin girişi</Link>
          </>}
        </nav>
        <p className="mt-3 text-xs leading-5">Müştəri və satıcı hesablarında Google-ı uyğun təhlükəsizlik bölməsindən bağlayın. Admin hesablarına Google bağlama dəstəklənmir; admin girişi üçün BAGATI şifrəsindən istifadə edin.</p>
      </>}
    </div>}
    <Link href={`/api/auth/google/start?${query.toString()}`} className="flex w-full items-center justify-center gap-3 rounded-full border border-line bg-white px-5 py-3.5 font-medium text-ink transition hover:bg-slate-50">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.75 3.27-8.1Z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.28-1.93-6.15-4.53H2.16v2.84A11 11 0 0 0 12 23Z"/><path fill="#FBBC05" d="M5.85 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.16a11 11 0 0 0 0 9.9l3.69-2.84Z"/><path fill="#EA4335" d="M12 4.36c1.62 0 3.07.56 4.21 1.68l3.15-3.15C17.45 1.1 14.97 0 12 0a11 11 0 0 0-9.84 7.05l3.69 2.84C6.72 7.29 9.14 4.36 12 4.36Z"/></svg>
      {mode === "link" ? "Google hesabını bağla" : "Google ilə davam et"}
    </Link>
    <div className="flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line"/><span>və ya e-poçtla</span><span className="h-px flex-1 bg-line"/></div>
  </div>;
}