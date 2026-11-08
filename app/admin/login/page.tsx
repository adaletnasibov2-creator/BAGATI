import { ActiveSessionNotice } from "@/components/active-session-notice";
import AdminLoginForm from "@/components/admin-login-form";
import { BrandLogo } from "@/components/brand-logo";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  return <main className="grid min-h-screen place-items-center bg-[#f7f5ef] p-4"><section className="w-full max-w-md rounded-3xl border border-[#e8e4db] bg-white p-7 shadow-[0_20px_55px_rgba(11,23,38,.08)] sm:p-9"><BrandLogo variant="full"/><p className="mt-9 text-xs font-semibold uppercase tracking-[.18em] text-[#9a783d]">BAGATI · İdarəetmə</p><h1 className="mt-2 text-3xl font-semibold text-[#0b1726]">Admin girişi</h1><p className="mt-2 text-sm leading-6 text-slate-500">Bu giriş yalnız aktiv ADMIN hesabları üçündür. Başqa admin hesabı ilə daxil olmaq hazırkı sessiyanı əvəz edir.</p><ActiveSessionNotice returnTo="/admin/login"/><AdminLoginForm/></section></main>;
}