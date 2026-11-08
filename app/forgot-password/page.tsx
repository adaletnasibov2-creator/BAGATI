import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="container grid min-h-[68vh] place-items-center py-10">
      <section className="w-full max-w-md rounded-[28px] border border-[#E6E9EC] border-t-[3px] border-t-[#C49A50] bg-white p-6 shadow-[0_24px_70px_rgba(11,23,38,.09)] sm:p-9">
        <BrandLogo variant="full" />
        <h1 className="mt-8 text-3xl font-semibold tracking-tight text-[#0B1726]">Şifrəni bərpa et</h1>
        <p className="mt-3 text-sm leading-6 text-[#667085]">Hesab e-poçtunuzu yazın. Ünvan aktiv hesabla uyğun gəlsə, bərpa keçidi göndəriləcək.</p>
        <ForgotPasswordForm />
        <Link href="/login" className="mt-6 block text-center text-sm font-medium text-[#9A701E]">Giriş səhifəsinə qayıt</Link>
      </section>
    </main>
  );
}
