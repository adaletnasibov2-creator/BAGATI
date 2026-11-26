import type { Metadata } from "next";
import Link from "next/link";
import { absoluteSiteUrl } from "@/lib/category-seo";
import { LegalDocument } from "@/components/legal-document";

// Legal page, final text of 2026-11-17 (owner); last section without the owner's details, heading reused from /terms (ABOUT-OWNER-INFO-2). Static text in code: no database read in this page.
const title = "Haqqımızda";
const description = "BAGATI sevdiyiniz mağazaları və məhsulları bir məkanda toplayan Azərbaycan onlayn bazarıdır.";

export function generateMetadata(): Metadata {
  const canonical = absoluteSiteUrl("/about");
  return { title, description, robots: { index: true, follow: true }, ...(canonical ? { alternates: { canonical } } : {}) };
}

const link = "rounded-sm font-medium text-primary underline underline-offset-2 hover:text-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export default function AboutPage() {
  // DESIGN-T9: shared reading layout; the document below is unchanged (only class names were removed from it).
  return <LegalDocument title={title}>
        <p><strong>BAGATI sevdiyiniz mağazaları və məhsulları bir məkanda toplayan Azərbaycan onlayn bazarıdır.</strong> Burada müxtəlif mağazalar öz məhsullarını təqdim edir, siz isə şəhərinizdəki və ya ölkənin hər yerindəki satıcılardan rahatlıqla seçim edirsiniz.</p>

        <h2>Niyə BAGATI?</h2>
        <ul>
          <li><strong>Bir yerdə çoxlu mağaza.</strong> Geyim, aksesuar, bəzək əşyaları və daha çox kateqoriya. Hər mağazanın öz səhifəsi, ünvanı və əlaqə məlumatı var.</li>
          <li><strong>Yerli satıcılara dəstək.</strong> Kiçik və orta sahibkarlar məhsullarını onlayn satmaq üçün bizim platformadan istifadə edir.</li>
          <li><strong>Şəffaf satıcılar.</strong> Mağaza açmaq istəyən hər satıcı VÖEN məlumatı ilə qeydiyyatdan keçir və yoxlanılır.</li>
          <li><strong>Satıcı ilə birbaşa əlaqə.</strong> Məhsul, sifariş və ya mağaza barədə sualınız varsa, mağazaya birbaşa mesaj yaza bilərsiniz.</li>
          <li><strong>Şəhərinizə görə seçim.</strong> Mağazalara və məhsullara yaşadığınız şəhər üzrə baxa bilərsiniz.</li>
        </ul>

        <h2>Necə işləyir?</h2>
        <ol>
          <li>Mağazaları və məhsulları kəşf edin, bəyəndiklərinizi səbətə əlavə edin.</li>
          <li>Çatdırılma ünvanınızı yazıb sifarişi tamamlayın. Bir səbətdə bir neçə mağazanın məhsulu ola bilər, hər mağaza öz sifarişini ayrıca hazırlayır.</li>
          <li>Mağaza sifarişi hazırlayır və çatdırır. Sifarişin vəziyyətini hesabınızdan izləyə bilərsiniz.</li>
          <li>Problem olsa, hesabınızdan qaytarma sorğusu göndərin. Qaytarma şərtləri mağazadan asılı ola bilər; sifarişdən əvvəl mağazadan soruşa bilərsiniz.</li>
        </ol>

        <h2>Bizimlə əlaqə</h2>
        <p>Sualınız, təklifiniz və ya şikayətiniz varsa, <Link href="/contact" className={link}>Əlaqə</Link> səhifəsindən bizə yaza bilərsiniz. Hər müraciəti oxuyuruq.</p>

        <h2>Platformamızın rolu</h2>
        <p>BAGATI məhsulları satan tərəf deyil, mağazalarla alıcıları bir araya gətirən platformadır. Hər məhsulu müvafiq mağaza satır. Ətraflı məlumat üçün <Link href="/terms" className={link}>İstifadə şərtlərinə</Link> baxın.</p>
  </LegalDocument>;
}
