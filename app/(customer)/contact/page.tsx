import type { Metadata } from "next";
import { absoluteSiteUrl } from "@/lib/category-seo";
import { LegalDocument } from "@/components/legal-document";

// Legal page, final text of 2026-11-17 (owner). Static text in code: no database read in this page.
const title = "Əlaqə";
const description = "Bizə e-poçt və ya telefonla yaza bilərsiniz; müraciətlərinizə adətən 1–2 iş günü ərzində cavab veririk.";

export function generateMetadata(): Metadata {
  const canonical = absoluteSiteUrl("/contact");
  return { title, description, robots: { index: true, follow: true }, ...(canonical ? { alternates: { canonical } } : {}) };
}

const link = "rounded-sm font-medium text-primary underline underline-offset-2 hover:text-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
const th = "border-b border-line px-3 py-2 font-semibold";
const td = "border-b border-line px-3 py-2 align-top";

export default function ContactPage() {
  // DESIGN-T9: shared reading layout; the document below is unchanged (only class names were removed from it).
  return <LegalDocument title={title}>
        <p><strong>Bizə e-poçt və ya telefonla yaza bilərsiniz; müraciətlərinizə adətən 1–2 iş günü ərzində cavab veririk.</strong></p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[20rem] border-collapse text-left text-sm">
            <thead><tr><th scope="col" className={th}>Məlumat</th><th scope="col" className={th}>Detal</th></tr></thead>
            <tbody>
              <tr><td className={td}>E-poçt</td><td className={td}><a href="mailto:adaletnasibov2@gmail.com" className={link}>adaletnasibov2@gmail.com</a></td></tr>
              <tr><td className={td}>Telefon</td><td className={td}><a href="tel:+994557614332" className={link}>+994 55 761 43 32</a></td></tr>
            </tbody>
          </table>
        </div>

        <h2>Kimə yazmalı?</h2>
        <ul>
          <li><strong>Sifariş, çatdırılma və qaytarma:</strong> İlk əvvəl mağazanın özünə yazın. Sifariş səhifəsindən və mağaza səhifəsindən mağazaya birbaşa mesaj göndərə bilərsiniz. Mağaza cavab verməsə və ya problem həll olunmasa, bizə yazın.</li>
          <li><strong>Hesab, sayt və ödəniş problemi:</strong> Birbaşa bizə yazın. Sifariş nömrəsini və problemin qısa təsvirini əlavə edin.</li>
          <li><strong>Şikayət və təklif:</strong> Mağaza və ya məhsul barədə şikayətinizi əsasları ilə yazın, araşdırıb geri dönəcəyik.</li>
          <li><strong>Mağaza açmaq istəyirsiniz?</strong> Satıcı olmaq üçün saytdakı „Satıcı ol“ düyməsindən başlayın; suallarınızı da bu ünvana yaza bilərsiniz.</li>
        </ul>

        <h2>Yazanda necə tez cavab ala bilərsiniz?</h2>
        <p>Müraciətinizdə adınızı, hesabda yazılan e-poçtunuzu, sifariş nömrəsini (varsa) və problemi qeyd edin. Bank kartı məlumatlarını, şifrəni və ya təhlükəsizlik kodlarını heç vaxt yazmayın, biz bunları heç vaxt istəmirik.</p>

        {/* ABOUT-OWNER-INFO-1: the operator details (same labels and values, moved from the table above) close the page. */}
        <dl className="mt-8 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-line pt-4 text-sm text-fg-muted">
          <dt>Operator</dt>
          <dd>Fərdi sahibkar Nəsibov Ədalət Şücaət oğlu</dd>
          <dt>VÖEN</dt>
          <dd>4202455532</dd>
          <dt>Hüquqi ünvan</dt>
          <dd>AZ3500, Qazax rayonu, Qazax şəhəri, N. Nərimanov küçəsi, ev 17</dd>
        </dl>
  </LegalDocument>;
}
