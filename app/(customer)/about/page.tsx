import type { Metadata } from "next";
import Link from "next/link";
import { absoluteSiteUrl } from "@/lib/category-seo";

// Legal page, final text of 2026-11-17 (owner). Static text in code: no database read in this page.
const title = "Haqqımızda";
const description = "BAGATI sevdiyiniz mağazaları və məhsulları bir məkanda toplayan Azərbaycan onlayn bazarıdır.";

export function generateMetadata(): Metadata {
  const canonical = absoluteSiteUrl("/about");
  return { title, description, robots: { index: true, follow: true }, ...(canonical ? { alternates: { canonical } } : {}) };
}

const h2 = "mt-4 text-xl font-semibold text-bagati-deep";
const link = "font-medium text-bagati-primary underline underline-offset-2";

export default function AboutPage() {
  return <div className="container py-10 sm:py-14">
    <article className="mx-auto max-w-3xl rounded-[24px] border border-[#E5E9E5] bg-white p-6 shadow-[0_10px_28px_rgba(23,58,58,.05)] sm:p-10">
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#173A3A]">{title}</h1>
      <div className="mt-5 grid gap-4 text-sm leading-7 text-bagati-secondary sm:text-base">
        <p><strong>BAGATI sevdiyiniz mağazaları və məhsulları bir məkanda toplayan Azərbaycan onlayn bazarıdır.</strong> Burada müxtəlif mağazalar öz məhsullarını təqdim edir, siz isə şəhərinizdəki və ya ölkənin hər yerindəki satıcılardan rahatlıqla seçim edirsiniz.</p>

        <h2 className={h2}>Niyə BAGATI?</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li><strong>Bir yerdə çoxlu mağaza.</strong> Geyim, aksesuar, bəzək əşyaları və daha çox kateqoriya. Hər mağazanın öz səhifəsi, ünvanı və əlaqə məlumatı var.</li>
          <li><strong>Yerli satıcılara dəstək.</strong> Kiçik və orta sahibkarlar məhsullarını onlayn satmaq üçün bizim platformadan istifadə edir.</li>
          <li><strong>Şəffaf satıcılar.</strong> Mağaza açmaq istəyən hər satıcı VÖEN məlumatı ilə qeydiyyatdan keçir və yoxlanılır.</li>
          <li><strong>Satıcı ilə birbaşa əlaqə.</strong> Məhsul, sifariş və ya mağaza barədə sualınız varsa, mağazaya birbaşa mesaj yaza bilərsiniz.</li>
          <li><strong>Şəhərinizə görə seçim.</strong> Mağazalara və məhsullara yaşadığınız şəhər üzrə baxa bilərsiniz.</li>
        </ul>

        <h2 className={h2}>Necə işləyir?</h2>
        <ol className="list-decimal space-y-1 pl-6">
          <li>Mağazaları və məhsulları kəşf edin, bəyəndiklərinizi səbətə əlavə edin.</li>
          <li>Çatdırılma ünvanınızı yazıb sifarişi tamamlayın. Bir səbətdə bir neçə mağazanın məhsulu ola bilər, hər mağaza öz sifarişini ayrıca hazırlayır.</li>
          <li>Mağaza sifarişi hazırlayır və çatdırır. Sifarişin vəziyyətini hesabınızdan izləyə bilərsiniz.</li>
          <li>Problem olsa, hesabınızdan qaytarma sorğusu göndərin. Qaytarma şərtləri mağazadan asılı ola bilər; sifarişdən əvvəl mağazadan soruşa bilərsiniz.</li>
        </ol>

        <h2 className={h2}>Kim idarə edir?</h2>
        <p>BAGATI-ni Qazax şəhərində fərdi sahibkar <strong>Nəsibov Ədalət Şücaət oğlu</strong> (VÖEN: 4202455532) idarə edir. BAGATI məhsulları satan tərəf deyil, mağazalarla alıcıları bir araya gətirən platformadır. Hər məhsulu müvafiq mağaza satır. Ətraflı məlumat üçün <Link href="/terms" className={link}>İstifadə şərtlərinə</Link> baxın.</p>

        <h2 className={h2}>Bizimlə əlaqə</h2>
        <p>Sualınız, təklifiniz və ya şikayətiniz varsa, <Link href="/contact" className={link}>Əlaqə</Link> səhifəsindən bizə yaza bilərsiniz. Hər müraciəti oxuyuruq.</p>
      </div>
    </article>
  </div>;
}
