import type { Metadata } from "next";
import { BrandLogo } from "@/components/brand-logo";
import { NotificationEmailVerify } from "@/components/notification-email-verify";

/** Opened from the link in the verification email (SELLER-ALERTS, part B). No login needed: the token is the proof. */
export const metadata: Metadata = { title: "Əlavə bildiriş e-poçtu", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function NotificationEmailVerifyPage() {
  return (
    <div className="container grid min-h-[68vh] place-items-center py-10 sm:py-14">
      <section className="w-full max-w-md rounded-[28px] border border-[#E6E9EC] border-t-[3px] border-t-[#C49A50] bg-white p-6 shadow-[0_24px_70px_rgba(11,23,38,.09)] sm:p-9">
        <BrandLogo variant="full" />
        <h1 className="mt-8 text-3xl font-semibold tracking-tight text-[#0B1726]">Əlavə bildiriş e-poçtu</h1>
        <NotificationEmailVerify />
      </section>
    </div>
  );
}
