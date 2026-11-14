/** Geri ödənişlər (/admin/refunds): static information page. Moved unchanged from app/admin/[...section]/page.tsx. */
import { type SectionContext, card, Header } from "./shared";

export async function renderRefunds({ shell }: SectionContext) {
  return shell(<><Header title="Geri ödənişlər"/><div className={card}><p className="font-medium">Xarici ödəniş provayderi qoşulmayıb</p><p className="mt-2 text-sm text-slate-500">Qaytarılma sorğuları mövcuddur, lakin geri ödəniş yalnız REFUND_PENDING vəziyyətində saxlanılır. Provayderdən təsdiq gəlmədən tamamlanmış geri ödəniş qeydi yaradılmır.</p></div></>);
}
