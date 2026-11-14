/** Ana səhifə və bannerlər (/admin/homepage). Moved unchanged from app/admin/[...section]/page.tsx. */
import AdminHomepageManager from "@/components/admin-homepage-manager";
import { type SectionContext, Header } from "./shared";

export async function renderHomepage({ shell }: SectionContext) {
  return shell(<><Header title="Ana səhifə və bannerlər" detail="Bannerlər yalnız aktiv və təyin olunmuş tarix aralığında göstərilir. Mağaza kampaniyaları mövcud satıcı kampaniya axınından idarə olunur."/><AdminHomepageManager/></>);
}
