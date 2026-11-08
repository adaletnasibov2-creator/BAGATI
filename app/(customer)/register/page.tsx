import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { RegisterForm } from "@/components/register-form";
import { safeOAuthNextPath } from "@/lib/google-oauth";
export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string; oauth?: string; portal?: string }> }) {
  const { next, oauth, portal } = await searchParams; const nextPath = safeOAuthNextPath(next, "customer");
  return <div className="container grid min-h-[68vh] place-items-center py-10 sm:py-14"><section className="w-full max-w-lg rounded-[28px] border border-[#E6E9EC] border-t-[3px] border-t-[#C49A50] bg-white p-6 shadow-[0_24px_70px_rgba(11,23,38,.09)] sm:p-9"><BrandLogo variant="full"/><div className="mt-8"><p className="text-xs font-semibold uppercase tracking-[.17em] text-[#85621d]">BAGATI hesabı</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#0B1726]">Hesab yarat</h1><p className="mt-3 text-sm leading-6 text-[#667085]">Sifarişlərini izləmək və hesab məlumatlarını idarə etmək üçün qeydiyyatdan keç.</p></div><RegisterForm nextPath={nextPath} oauthError={oauth} portal={portal}/><p className="mt-5 text-center text-sm text-[#667085]">Artıq hesabın var? <Link href="/login" className="font-semibold text-[#85621d]">Daxil ol</Link></p></section></div>;
}
