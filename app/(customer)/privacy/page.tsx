import type { Metadata } from "next";
import { TextLink } from "@/components/ui/text-link";
import { absoluteSiteUrl } from "@/lib/category-seo";
import { LegalDocument } from "@/components/legal-document";

// Legal page, final text of 2026-11-17 (owner). Static text in code: no database read in this page.
const title = "Məxfilik siyasəti";
const description = "Biz yalnız sifarişi yerinə yetirmək, hesabınızı qorumaq və sizinlə əlaqə saxlamaq üçün lazım olan məlumatları toplayırıq.";

export function generateMetadata(): Metadata {
  const canonical = absoluteSiteUrl("/privacy");
  return { title, description, robots: { index: true, follow: true }, ...(canonical ? { alternates: { canonical } } : {}) };
}

const th = "border-b border-line px-3 py-2 font-semibold";
const td = "border-b border-line px-3 py-2 align-top";

export default function PrivacyPage() {
  // DESIGN-T9: shared reading layout; the document below is unchanged (only class names were removed from it).
  return <LegalDocument title={title}>
        <p><strong>Biz yalnız sifarişi yerinə yetirmək, hesabınızı qorumaq və sizinlə əlaqə saxlamaq üçün lazım olan məlumatları toplayırıq.</strong> Bu səhifə hansı məlumatların toplandığını, nə üçün istifadə olunduğunu, kimlərlə paylaşıldığını və sizin hüquqlarınızı izah edir. Məlumatların operatoru: fərdi sahibkar Nəsibov Ədalət Şücaət oğlu, VÖEN 4202455532, Qazax şəhəri.</p>

        <h2>Hansı məlumatları toplayırıq?</h2>
        <ul>
          <li><strong>Hesab məlumatları:</strong> ad, e-poçt ünvanı, telefon (istəyə bağlı). Google ilə daxil olsanız, Google-dan ad, e-poçt və Google hesabının identifikatorunu alırıq, başqa məlumat saxlamırıq. E-poçt və şifrə ilə qeydiyyatda şifrə yalnız qorunan (hash) formada saxlanılır.</li>
          <li><strong>Sifariş məlumatları:</strong> çatdırılma ünvanı, alıcının adı və telefonu, sifariş edilən məhsullar, məbləğ və sifariş tarixçəsi.</li>
          <li><strong>Mesajlar:</strong> mağazaya yazdığınız mesajlar və mağazanın cavabları. Mağaza sizin yalnız göstərilən adınızı görür.</li>
          <li><strong>Texniki məlumatlar:</strong> giriş cəhdləri və təhlükəsizlik jurnalı (məsələn, şübhəli girişləri müəyyən etmək üçün).</li>
          <li><strong>Ödəniş:</strong> bank kartı məlumatlarınızı biz görmürük və saxlamırıq. Onlayn ödəniş aktiv olduğu zaman kart məlumatları yalnız ödəniş xidmətinin (Epoint) təhlükəsiz səhifəsində daxil edilir.</li>
        </ul>

        <h2>Nə üçün istifadə edirik?</h2>
        <ol>
          <li>Sifarişi qəbul etmək, mağazaya ötürmək və çatdırılma üçün.</li>
          <li>Hesabınızı idarə etmək və təhlükəsizliyi təmin etmək üçün.</li>
          <li>Sizinlə sifariş, qaytarma və hesab barədə e-poçtla əlaqə saxlamaq üçün (məsələn, təsdiq kodu, şifrə bərpası, yeni mesaj bildirişi).</li>
          <li>Aldatmanın və sui-istifadənin qarşısını almaq üçün.</li>
          <li>Qanunvericiliyin tələblərini yerinə yetirmək üçün.</li>
        </ol>
        <p>Məlumatlarınızı satmırıq və reklam məqsədilə üçüncü tərəflərə vermirik.</p>

        <h2>Kimlərlə paylaşılır?</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
            <thead><tr><th scope="col" className={th}>Kim</th><th scope="col" className={th}>Nə üçün</th><th scope="col" className={th}>Hansı məlumat</th></tr></thead>
            <tbody>
              <tr><td className={td}>Sifarişi hazırlayan mağaza</td><td className={td}>Sifarişi hazırlayıb çatdırmaq</td><td className={td}>Ad, telefon, çatdırılma ünvanı, sifariş edilən məhsullar</td></tr>
              <tr><td className={td}>Ödəniş xidməti (Epoint)</td><td className={td}>Onlayn ödənişi qəbul etmək və geri ödəmək</td><td className={td}>Sifariş nömrəsi, məbləğ (kart məlumatları yalnız ödəniş xidmətində)</td></tr>
              <tr><td className={td}>E-poçt xidməti (Brevo)</td><td className={td}>Bildiriş və təsdiq e-poçtlarını göndərmək</td><td className={td}>E-poçt ünvanı və məktubun mətni</td></tr>
              <tr><td className={td}>Google</td><td className={td}>Google hesabı ilə giriş</td><td className={td}>Ad, e-poçt</td></tr>
              <tr><td className={td}>OpenStreetMap</td><td className={td}>Xəritələri göstərmək</td><td className={td}>Xəritə açılanda brauzer sorğusu: IP ünvanı və brauzer məlumatı</td></tr>
              <tr><td className={td}>Hosting və infrastruktur (Cloudways, Cloudflare)</td><td className={td}>Saytın işləməsi və şəkillərin saxlanması</td><td className={td}>Texniki məlumatlar</td></tr>
              <tr><td className={td}>Dövlət orqanları</td><td className={td}>Yalnız qanunun tələb etdiyi hallarda</td><td className={td}>Qanunla tələb olunan məlumat</td></tr>
            </tbody>
          </table>
        </div>

        <h2>Mesajlarınıza kim baxa bilər?</h2>
        <p>Mesajlar yalnız siz və müvafiq mağaza arasındadır. Platforma administratoru söhbətə yalnız kimsə şikayət göndərdikdə və yalnız həmin söhbəti yoxlamaq üçün baxa bilər. Hər belə baxış jurnalda qeyd olunur. Mesajlarda telefon nömrəsi və e-poçt ünvanı paylaşmaq təhlükəsizlik üçün məhdudlaşdırıla bilər.</p>

        <h2>Cookie-lər</h2>
        <p>Sayt giriş etdiyinizi xatırlamaq, Google ilə daxil olmaq və hesabınızı qorumaq üçün yalnız zəruri cookie-lərdən istifadə edir. Reklam və izləmə cookie-ləri istifadə etmirik. Seçdiyiniz şəhər və sevimli məhsullarınız brauzerinizin yaddaşında saxlanılır.</p>

        <h2>Məlumatlar nə qədər saxlanılır?</h2>
        <p>Hesab məlumatlarınız hesabınız aktiv olduğu müddət saxlanılır. Sifariş qeydləri mühasibat və hüquqi tələblərə görə qanunun tələb etdiyi müddət ərzində qala bilər.</p>

        <h2>Sizin hüquqlarınız</h2>
        <p>Şəxsi məlumatlarınıza dair Azərbaycan qanunvericiliyinin verdiyi hüquqlardan istifadə edə bilərsiniz:</p>
        <ul>
          <li>hansı məlumatlarınızın saxlandığını öyrənmək;</li>
          <li>yanlış və ya əskik məlumatı düzəltdirmək;</li>
          <li>hesabınızın və məlumatlarınızın silinməsini tələb etmək (qanunla saxlanmalı qeydlər istisna olmaqla);</li>
          <li>məlumatların istifadəsinə etiraz etmək.</li>
        </ul>
        <p>Bunun üçün <TextLink href="/contact">Əlaqə</TextLink> səhifəsindəki e-poçt ünvanına yazın. Müraciətinizə mümkün qədər tez, qanunda göstərilən müddət ərzində cavab veririk.</p>

        <h2>Dəyişikliklər</h2>
        <p>Bu siyasəti vaxtaşırı yeniləyə bilərik. Əsas dəyişikliklər bu səhifədə dərc olunacaq. Son yenilənmə: 17 noyabr 2026.</p>
  </LegalDocument>;
}
