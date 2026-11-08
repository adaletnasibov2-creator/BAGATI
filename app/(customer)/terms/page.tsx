import Link from "next/link";

export default function TermsPage() {
  return (
    <div className="container py-10 sm:py-14">
      <article className="mx-auto max-w-3xl rounded-[24px] border border-[#E5E9E5] bg-white p-6 shadow-[0_10px_28px_rgba(23,58,58,.05)] sm:p-10">
        <p className="inline-flex rounded-full bg-[#F6F0E4] px-3 py-1.5 text-xs font-semibold text-[#765719]">
          Hüquqi yoxlama üçün ilkin layihə — yekun təsdiq tələb olunur.
        </p>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-[#173A3A]">İstifadə şərtləri</h1>
        <p className="mt-4 text-sm leading-7 text-[#697875]">
          Bu səhifənin yekun mətni BAGATI platformasının müştəri və satıcı qaydaları, sifarişlər, ödənişlər, çatdırılma, qaytarılma və mübahisələrin həlli üzrə təsdiqlənmiş şərtlərə əsasən hazırlanmalıdır. Hazırda burada təsdiqlənmiş istifadə şərtləri dərc olunmayıb.
        </p>
        <p className="mt-3 text-sm leading-7 text-[#697875]">
          Mövcud çatdırılma və qaytarılma məlumatlarına <Link className="font-semibold text-[#2F6F68] underline underline-offset-4" href="/delivery-returns">buradan</Link> baxın və suallar üçün <Link className="font-semibold text-[#2F6F68] underline underline-offset-4" href="/support">dəstəyə müraciət edin</Link>.
        </p>
      </article>
    </div>
  );
}
