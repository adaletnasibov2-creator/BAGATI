import type { Metadata } from "next";
import { TextLink } from "@/components/ui/text-link";
import { BrandLogo } from "@/components/brand-logo";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { PublicTheme } from "@/components/public-theme";

export const metadata: Metadata = {
  title: "Şifrəni yenilə | BAGATI",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return (
    <PublicTheme><main className="container grid min-h-[68vh] place-items-center py-10">
      <section className="w-full max-w-md rounded-[28px] border border-[#E6E9EC] border-t-[3px] border-t-[#C49A50] bg-white p-6 shadow-[0_24px_70px_rgba(11,23,38,.09)] sm:p-9">
        <BrandLogo variant="full" />
        <h1 className="mt-8 text-3xl font-semibold tracking-tight text-[#0B1726]">Yeni şifrə təyin et</h1>
        <p className="mt-3 text-sm leading-6 text-[#667085]">Yeni şifrəniz ən azı 12 simvol olmalıdır. Bərpa keçidi 30 dəqiqə sonra qüvvədən düşür.</p>
        {/* DESIGN-T9: the form decides its state after load (token from the fragment); this box keeps the card the same
            height for "yoxlanılır", "no link" and the form, so the centred card does not jump. */}
        <div className="min-h-[17rem]"><ResetPasswordForm token={token} /></div>
        <TextLink href="/login" underline={false} className="mx-auto mt-4 flex min-h-11 w-fit items-center text-sm">Giriş səhifəsinə qayıt</TextLink>
      </section>
    </main></PublicTheme>
  );
}
