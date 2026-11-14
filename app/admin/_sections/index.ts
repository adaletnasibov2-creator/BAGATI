/**
 * Admin sections moved out of the catch-all, in the catch-all's original branch order (first match wins; matchers
 * are the original conditions). Generated list; keep the order when editing.
 */
import type { ReactNode } from "react";
import type { SectionContext } from "./shared";
import { renderHomepage } from "./homepage";
import { renderPromotions } from "./promotions";
import { renderPayments } from "./payments";
import { renderRefunds } from "./refunds";
import { renderNotifications } from "./notifications";

export type AdminSection = { match: (route: string, parts: string[]) => boolean; render: (ctx: SectionContext) => Promise<ReactNode> };

export const ADMIN_SECTIONS: AdminSection[] = [
  { match: (route, parts) => route==="homepage", render: renderHomepage },
  { match: (route, parts) => route==="promotions", render: renderPromotions },
  { match: (route, parts) => route==="payments", render: renderPayments },
  { match: (route, parts) => route==="refunds", render: renderRefunds },
  { match: (route, parts) => route==="notifications", render: renderNotifications },
];
/* ENTRIES [{"module":"homepage","exportName":"renderHomepage","matchExpr":"route===\"homepage\""},{"module":"promotions","exportName":"renderPromotions","matchExpr":"route===\"promotions\""},{"module":"payments","exportName":"renderPayments","matchExpr":"route===\"payments\""},{"module":"refunds","exportName":"renderRefunds","matchExpr":"route===\"refunds\""},{"module":"notifications","exportName":"renderNotifications","matchExpr":"route===\"notifications\""}] */
