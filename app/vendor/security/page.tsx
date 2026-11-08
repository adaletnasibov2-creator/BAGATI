import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { GoogleOAuthButton } from "@/components/google-oauth-button";
import { GoogleUnlinkButton } from "@/components/google-unlink-button";
import { PasswordChangeForm } from "@/components/password-change-form";
import VendorLogoutButton from "@/components/vendor-logout-button";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function VendorSecurityPage({ searchParams }: { searchParams: Promise<{ oauth?: string; portal?: string }> }) {
  const user = await currentUser();
  if (!user || user.role !== "VENDOR") redirect("/vendor/login");
  const [{ oauth, portal }, googleAccount, accountSecurity] = await Promise.all([
    searchParams,
    prisma.googleAccount.findUnique({ where: { userId: user.id }, select: { id: true } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { passwordAuthEnabled: true } }),
  ]);
  return (
    <main className="min-h-screen bg-[#F7F5EF] text-[#16202C]">
      <header className="border-b border-[#E8E7E2] bg-white">
        <div className="container flex items-center justify-between py-4">
          <BrandLogo variant="compact" />
          <div className="flex items-center gap-4">
            <Link href="/vendor" className="text-sm text-[#85621d]">Satıcı paneli</Link>
            <VendorLogoutButton />
          </div>
        </div>
      </header>
      <section className="container max-w-2xl py-10">
        <h1 className="text-3xl font-semibold text-[#0B1726]">Hesabın təhlükəsizliyi</h1>
        <div className="mt-6 rounded-2xl border border-[#E8E7E2] bg-white p-6">
          <h2 className="font-semibold">Şifrə</h2>
          {accountSecurity?.passwordAuthEnabled
            ? <PasswordChangeForm />
            : <p className="mt-2 text-sm text-[#667085]">Bu hesab Google ilə idarə olunur; BAGATI şifrəsi dəyişdirilmir.</p>}
          <div className="mt-7 border-t border-[#E8E7E2] pt-6">
            <h2 className="font-semibold">Google hesabı</h2>
            {googleAccount
              ? <GoogleUnlinkButton canUnlink={Boolean(accountSecurity?.passwordAuthEnabled)} />
              : <GoogleOAuthButton intent="vendor" mode="link" nextPath="/vendor/security" errorCode={oauth} portal={portal} />}
          </div>
          <p className="mt-6 border-t border-[#E8E7E2] pt-5 text-sm text-[#667085]">
            Google hesabını bağlamaq üçün daxil olduğunuz BAGATI hesabı ilə eyni, Google tərəfindən təsdiqlənmiş e-poçt istifadə olunur.
          </p>
        </div>
      </section>
    </main>
  );
}
