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
// ABOUT-OWNER-INFO-2: e-mail and phone as two calm cards (label above value, 44 px tap target), side by side from sm.
const card = "min-w-0 rounded-card border border-line bg-surface-page px-4 py-3";
const cardLabel = "block text-sm font-semibold text-fg-secondary";
const cardLink = `${link} mt-1 inline-flex min-h-11 max-w-full items-center break-all text-body`;

export default function ContactPage() {
  // DESIGN-T9: shared reading layout; the document below is unchanged (only class names were removed from it).
  return <LegalDocument title={title}>
        <p><strong>Bizə e-poçt və ya telefonla yaza bilərsiniz; müraciətlərinizə adətən 1–2 iş günü ərzində cavab veririk.</strong></p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className={card}>
            <span className={cardLabel}>E-poçt</span>
            <a href="mailto:adaletnasibov2@gmail.com" className={cardLink}>adaletnasibov2@gmail.com</a>
          </div>
          <div className={card}>
            <span className={cardLabel}>Telefon</span>
            <a href="tel:+994557614332" className={cardLink}>+994 55 761 43 32</a>
          </div>
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

        {/* ABOUT-OWNER-INFO-1/2: the operator details close the page, in normal body text (same labels and values). */}
        <dl className="mt-10 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-line pt-6 text-body text-fg-body">
          <dt className="font-semibold text-fg">Operator</dt>
          <dd className="min-w-0 break-words">Fərdi sahibkar Nəsibov Ədalət Şücaət oğlu</dd>
          <dt className="font-semibold text-fg">VÖEN</dt>
          <dd className="min-w-0 break-words">4202455532</dd>
          <dt className="font-semibold text-fg">Hüquqi ünvan</dt>
          <dd className="min-w-0 break-words">AZ3500, Qazax rayonu, Qazax şəhəri, N. Nərimanov küçəsi, ev 17</dd>
        </dl>
  </LegalDocument>;
}
