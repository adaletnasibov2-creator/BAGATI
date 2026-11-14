/**
 * Admin sections moved out of the catch-all, in the catch-all's original branch order (first match wins; matchers
 * are the original conditions). Generated list; keep the order when editing.
 */
import type { ReactNode } from "react";
import type { SectionContext } from "./shared";
import { renderSettings } from "./settings";
import { renderHomepage } from "./homepage";
import { renderPromotions } from "./promotions";
import { renderPayments } from "./payments";
import { renderCustomers } from "./customers";
import { renderCategories } from "./categories";
import { renderBrands } from "./brands";
import { renderCities } from "./cities";
import { renderRefunds } from "./refunds";
import { renderReviews } from "./reviews";
import { renderSupport } from "./support";
import { renderSupportDetail } from "./support-detail";
import { renderImports } from "./imports";
import { renderNotifications } from "./notifications";

export type AdminSection = { match: (route: string, parts: string[]) => boolean; render: (ctx: SectionContext) => Promise<ReactNode> };

export const ADMIN_SECTIONS: AdminSection[] = [
  { match: (route, parts) => route==="settings", render: renderSettings },
  { match: (route, parts) => route==="homepage", render: renderHomepage },
  { match: (route, parts) => route==="promotions", render: renderPromotions },
  { match: (route, parts) => route==="payments", render: renderPayments },
  { match: (route, parts) => route==="customers", render: renderCustomers },
  { match: (route, parts) => route==="categories", render: renderCategories },
  { match: (route, parts) => route==="brands", render: renderBrands },
  { match: (route, parts) => route==="cities", render: renderCities },
  { match: (route, parts) => route==="refunds", render: renderRefunds },
  { match: (route, parts) => route==="reviews", render: renderReviews },
  { match: (route, parts) => route==="support", render: renderSupport },
  { match: (route, parts) => parts[0]==="support"&&parts.length===2, render: renderSupportDetail },
  { match: (route, parts) => route==="imports", render: renderImports },
  { match: (route, parts) => route==="notifications", render: renderNotifications },
];
/* ENTRIES [{"module":"settings","exportName":"renderSettings","matchExpr":"route===\"settings\""},{"module":"homepage","exportName":"renderHomepage","matchExpr":"route===\"homepage\""},{"module":"promotions","exportName":"renderPromotions","matchExpr":"route===\"promotions\""},{"module":"payments","exportName":"renderPayments","matchExpr":"route===\"payments\""},{"module":"customers","exportName":"renderCustomers","matchExpr":"route===\"customers\""},{"module":"categories","exportName":"renderCategories","matchExpr":"route===\"categories\""},{"module":"brands","exportName":"renderBrands","matchExpr":"route===\"brands\""},{"module":"cities","exportName":"renderCities","matchExpr":"route===\"cities\""},{"module":"refunds","exportName":"renderRefunds","matchExpr":"route===\"refunds\""},{"module":"reviews","exportName":"renderReviews","matchExpr":"route===\"reviews\""},{"module":"support","exportName":"renderSupport","matchExpr":"route===\"support\""},{"module":"support-detail","exportName":"renderSupportDetail","matchExpr":"parts[0]===\"support\"&&parts.length===2"},{"module":"imports","exportName":"renderImports","matchExpr":"route===\"imports\""},{"module":"notifications","exportName":"renderNotifications","matchExpr":"route===\"notifications\""}] */
