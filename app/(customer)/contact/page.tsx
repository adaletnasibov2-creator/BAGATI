import type { Metadata } from "next";
import { absoluteSiteUrl } from "@/lib/category-seo";

// Legal page, final text of 2026-11-17 (owner). Static text in code: no database read in this page.
const title = "Əlaqə";
const description = "Bizə e-poçt və ya telefonla yaza bilərsiniz; müraciətlərinizə adətən 1–2 iş günü ərzində cavab veririk.";

export function generateMetadata(): Metadata {
  const canonical = absoluteSiteUrl("/contact");
  return { title, description, robots: { index: true, follow: true }, ...(canonical ? { alternates: { canonical } } : {}) };
}

const h2 = "mt-4 text-xl font-semibold text-bagati-deep";
const link = "font-medium text-bagati-primary underline underline-offset-2";
const th = "border-b border-[#E5E9E5] px-3 py-2 font-semibold text-bagati-deep";
const td = "border-b border-[#E5E9E5] px-3 py-2 align-top";

export default function ContactPage() {
  return <div className="container py-10 sm:py-14">
    <article className="mx-auto max-w-3xl rounded-[24px] border border-[#E5E9E5] bg-white p-6 shadow-[0_10px_28px_rgba(23,58,58,.05)] sm:p-10">
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#173A3A]">{title}</h1>
      <div className="mt-5 grid gap-4 text-sm leading-7 text-bagati-secondary sm:text-base">
        <p><strong>Bizə e-poçt və ya telefonla yaza bilərsiniz; müraciətlərinizə adətən 1–2 iş günü ərzində cavab veririk.</strong></p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[20rem] border-collapse text-left text-sm">
            <thead><tr><th scope="col" className={th}>Məlumat</th><th scope="col" className={th}>Detal</th></tr></thead>
            <tbody>
              <tr><td className={td}>E-poçt</td><td className={td}><a href="mailto:adaletnasibov2@gmail.com" className={link}>adaletnasibov2@gmail.com</a></td></tr>
              <tr><td className={td}>Telefon</td><td className={td}><a href="tel:+994557614332" className={link}>+994 55 761 43 32</a></td></tr>
              <tr><td className={td}>Operator</td><td className={td}>Fərdi sahibkar Nəsibov Ədalət Şücaət oğlu</td></tr>
              <tr><td className={td}>VÖEN</td><td className={td}>4202455532</td></tr>
              <tr><td className={td}>Hüquqi ünvan</td><td className={td}>AZ3500, Qazax rayonu, Qazax şəhəri, N. Nərimanov küçəsi, ev 17</td></tr>
            </tbody>
          </table>
        </div>

        <h2 className={h2}>Kimə yazmalı?</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li><strong>Sifariş, çatdırılma və qaytarma:</strong> İlk əvvəl mağazanın özünə yazın. Sifariş səhifəsindən və mağaza səhifəsindən mağazaya birbaşa mesaj göndərə bilərsiniz. Mağaza cavab verməsə və ya problem həll olunmasa, bizə yazın.</li>
          <li><strong>Hesab, sayt və ödəniş problemi:</strong> Birbaşa bizə yazın. Sifariş nömrəsini və problemin qısa təsvirini əlavə edin.</li>
          <li><strong>Şikayət və təklif:</strong> Mağaza və ya məhsul barədə şikayətinizi əsasları ilə yazın, araşdırıb geri dönəcəyik.</li>
          <li><strong>Mağaza açmaq istəyirsiniz?</strong> Satıcı olmaq üçün saytdakı „Satıcı ol“ düyməsindən başlayın; suallarınızı da bu ünvana yaza bilərsiniz.</li>
        </ul>

        <h2 className={h2}>Yazanda necə tez cavab ala bilərsiniz?</h2>
        <p>Müraciətinizdə adınızı, hesabda yazılan e-poçtunuzu, sifariş nömrəsini (varsa) və problemi qeyd edin. Bank kartı məlumatlarını, şifrəni və ya təhlükəsizlik kodlarını heç vaxt yazmayın, biz bunları heç vaxt istəmirik.</p>
      </div>
    </article>
  </div>;
}
