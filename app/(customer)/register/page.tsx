import { TextLink } from "@/components/ui/text-link";
import { AuthTabs, authTabHref } from "@/components/auth-tabs";
import { BrandLogo } from "@/components/brand-logo";
import { RegisterForm } from "@/components/register-form";
import { safeOAuthNextPath } from "@/lib/google-oauth";
import { readPendingGoogleSignup } from "@/lib/google-pending-signup";
export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string; oauth?: string; portal?: string }> }) {
  const { next, oauth, portal } = await searchParams; const nextPath = safeOAuthNextPath(next, "customer");
  // SIGNUP-EASY-2: a verified Google identity waiting in the signed HttpOnly cookie (only the e-mail reaches the page).
  const googlePending = await readPendingGoogleSignup();
  return <div className="container grid min-h-[68vh] place-items-center py-10 sm:py-14"><section className="w-full max-w-lg rounded-[28px] border border-[#E6E9EC] border-t-[3px] border-t-[#C49A50] bg-white p-6 shadow-[0_24px_70px_rgba(11,23,38,.09)] sm:p-9"><BrandLogo variant="full"/><div className="mt-8"><p className="text-kicker uppercase text-gold-700">BAGATI hesabı</p><h1 className="mt-2 font-display text-h1 text-fg">Hesab yarat</h1><p className="mt-3 text-sm leading-6 text-fg-secondary">Sifarişlərini izləmək və hesab məlumatlarını idarə etmək üçün qeydiyyatdan keç.</p></div><AuthTabs active="register" nextPath={nextPath}/><RegisterForm nextPath={nextPath} oauthError={oauth} portal={portal} googlePendingEmail={googlePending?.identity.email}/><p className="mt-5 text-center text-sm text-fg-secondary">Artıq hesabın var? <TextLink href={authTabHref("/login", nextPath)} className="font-semibold">Daxil ol</TextLink></p></section></div>;
}
