/** Ödənişlər (/admin/payments): static information page. Moved unchanged from app/admin/[...section]/page.tsx. */
import { type SectionContext, card, Header } from "./shared";

export async function renderPayments({ shell }: SectionContext) {
  return shell(<><Header title="Ödənişlər" detail="Epoint yalnız server konfiqurasiyası tam olduqda aktiv olur. Bu səhifə kart məlumatı saxlamır və ödəniş əməliyyatı göndərmir."/><section className={card}><p className="font-medium">Ödəniş statusu sifarişin daxilində görünür.</p><p className="mt-2 text-sm text-slate-600">Məbləğ və status bankın imzalanmış callback-i və status sorğusu təsdiqləndikdən sonra dəyişir. Brauzerin qayıtması ödənişi təsdiqləmir.</p></section></>);
}
