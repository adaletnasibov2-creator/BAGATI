/** Kampaniyalar (/admin/promotions). Moved unchanged from app/admin/[...section]/page.tsx. */
import AdminPromotionManager from "@/components/admin-promotion-manager";
import { type SectionContext, Header } from "./shared";

export async function renderPromotions({ shell }: SectionContext) {
  return shell(<><Header title="Kampaniyalar" detail="Mağaza məhsullarına tarix və status əsasında endirim kampaniyaları təyin edin."/><AdminPromotionManager/></>);
}
