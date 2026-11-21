import { redirect } from "next/navigation";
import { ActiveSessionNotice } from "@/components/active-session-notice";
import { AuthTabs } from "@/components/auth-tabs";
import { BrandLogo } from "@/components/brand-logo";
import { LoginForm } from "@/components/login-form";
import { safeOAuthNextPath } from "@/lib/google-oauth";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; oauth?: string; verified?: string; portal?: string }> }) {
  const { next, oauth, verified, portal } = await searchParams;
  if (oauth === "link-pending") redirect("/auth/google/link");
  const nextPath = safeOAuthNextPath(next, "customer");
  const returnTo = `/login?next=${encodeURIComponent(nextPath)}`;
  const notice = verified === "1" ? "Email ünvanınız təsdiqləndi. İndi hesabınıza daxil ola bilərsiniz." : undefined;
  const explanation = nextPath.startsWith("/checkout")
    ? "Sifarişi tamamlamaq və ünvan məlumatlarını seçmək üçün hesabınıza daxil olun."
    : nextPath.startsWith("/account") || nextPath.startsWith("/orders")
      ? "Hesab məlumatlarınızı və sifariş tarixçənizi görmək üçün daxil olun."
      : "Davam etmək üçün BAGATI hesabınıza daxil olun.";
  return <div className="container grid min-h-[68vh] place-items-center py-10 sm:py-14"><section className="w-full max-w-md rounded-[28px] border border-[#E6E9EC] border-t-[3px] border-t-[#C49A50] bg-white p-6 shadow-[0_24px_70px_rgba(11,23,38,.09)] sm:p-9"><BrandLogo variant="full"/><div className="mt-8"><p className="text-kicker uppercase text-gold-700">BAGATI hesabı</p><h1 className="mt-2 font-display text-h1 text-fg">Xoş gəlmisiniz</h1><p className="mt-3 text-sm leading-6 text-fg-secondary">{explanation}</p></div><AuthTabs active="login" nextPath={nextPath}/><ActiveSessionNotice returnTo={returnTo}/><LoginForm nextPath={nextPath} oauthError={oauth} notice={notice} portal={portal}/></section></div>;
}