import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { GoogleOAuthButton } from "@/components/google-oauth-button";
import { GoogleUnlinkButton } from "@/components/google-unlink-button";
import { PasswordChangeForm } from "@/components/password-change-form";
import VendorLogoutButton from "@/components/vendor-logout-button";
import { currentUser } from "@/lib/auth";
import { vendorAreaRedirectPath } from "@/lib/vendor-area";
import { prisma } from "@/lib/prisma";
import { VendorTheme } from "@/components/vendor-theme";
import { VendorPageHeader } from "@/components/vendor-page-header";

export const dynamic = "force-dynamic";

export default async function VendorSecurityPage({ searchParams }: { searchParams: Promise<{ oauth?: string; portal?: string }> }) {
  const user = await currentUser();
  if (!user || user.role !== "VENDOR") redirect(vendorAreaRedirectPath(user?.role));
  const [{ oauth, portal }, googleAccount, accountSecurity] = await Promise.all([
    searchParams,
    prisma.googleAccount.findUnique({ where: { userId: user.id }, select: { id: true } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { passwordAuthEnabled: true } }),
  ]);
  return (
    <VendorTheme><main className="min-h-screen bg-surface-page text-fg-body">
      <header className="border-b border-line bg-white">
        <div className="container flex items-center justify-between py-4">
          <BrandLogo variant="compact" />
          <div className="flex items-center gap-4">
            <Link href="/vendor" className="text-sm font-medium text-primary hover:text-primary-hover">Satıcı paneli</Link>
            <VendorLogoutButton />
          </div>
        </div>
      </header>
      <section className="container max-w-2xl py-10">
        <VendorPageHeader eyebrow="Satıcı portalı" title="Hesabın təhlükəsizliyi"/>
        <div className="mt-6 rounded-card border border-line bg-white p-6">
          <h2 className="font-semibold">Şifrə</h2>
          {accountSecurity?.passwordAuthEnabled
            ? <PasswordChangeForm />
            : <p className="mt-2 text-sm text-fg-secondary">Bu hesab Google ilə idarə olunur; BAGATI şifrəsi dəyişdirilmir.</p>}
          <div className="mt-7 border-t border-line pt-6">
            <h2 className="font-semibold">Google hesabı</h2>
            {googleAccount
              ? <GoogleUnlinkButton canUnlink={Boolean(accountSecurity?.passwordAuthEnabled)} />
              : <GoogleOAuthButton intent="vendor" mode="link" nextPath="/vendor/security" errorCode={oauth} portal={portal} />}
          </div>
          <p className="mt-6 border-t border-line pt-5 text-sm text-fg-secondary">
            Google hesabını bağlamaq üçün daxil olduğunuz BAGATI hesabı ilə eyni, Google tərəfindən təsdiqlənmiş e-poçt istifadə olunur.
          </p>
        </div>
      </section>
    </main></VendorTheme>
  );
}
