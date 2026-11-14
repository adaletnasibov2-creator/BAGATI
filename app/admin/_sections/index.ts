/**
 * Admin sections, in the original order of the former catch-all branches: the first match renders. Each matcher
 * is the original route condition. Keep the order when adding a section (e.g. stores/new before stores/:id).
 */
import type { ReactNode } from "react";
import type { SectionContext } from "./shared";
import { renderSettings } from "./settings";
import { renderHomepage } from "./homepage";
import { renderPromotions } from "./promotions";
import { renderPayments } from "./payments";
import { renderStoresNew } from "./stores-new";
import { renderVendorsNew } from "./vendors-new";
import { renderStores } from "./stores";
import { renderStoreDetail } from "./store-detail";
import { renderVendors } from "./vendors";
import { renderVendorDetail } from "./vendor-detail";
import { renderCustomers } from "./customers";
import { renderCustomerDetail } from "./customer-detail";
import { renderProducts } from "./products";
import { renderProductDetail } from "./product-detail";
import { renderCategories } from "./categories";
import { renderBrands } from "./brands";
import { renderCities } from "./cities";
import { renderOrders } from "./orders";
import { renderOrderDetail } from "./order-detail";
import { renderSubscriptions } from "./subscriptions";
import { renderCommissions } from "./commissions";
import { renderReturns } from "./returns";
import { renderRefunds } from "./refunds";
import { renderReviews } from "./reviews";
import { renderSupport } from "./support";
import { renderSupportDetail } from "./support-detail";
import { renderImports } from "./imports";
import { renderNotifications } from "./notifications";
import { renderReports } from "./reports";

export type AdminSection = { match: (where: { route: string; parts: string[] }) => boolean; render: (ctx: SectionContext) => Promise<ReactNode> };

export const ADMIN_SECTIONS: AdminSection[] = [
  { match: ({ route }) => route==="settings", render: renderSettings },
  { match: ({ route }) => route==="homepage", render: renderHomepage },
  { match: ({ route }) => route==="promotions", render: renderPromotions },
  { match: ({ route }) => route==="payments", render: renderPayments },
  { match: ({ route }) => route==="stores/new", render: renderStoresNew },
  { match: ({ route }) => route==="vendors/new", render: renderVendorsNew },
  { match: ({ route }) => route==="stores", render: renderStores },
  { match: ({ parts }) => parts[0]==="stores"&&parts.length===2, render: renderStoreDetail },
  { match: ({ route }) => route==="vendors", render: renderVendors },
  { match: ({ parts }) => parts[0] === "vendors" && parts.length === 2, render: renderVendorDetail },
  { match: ({ route }) => route==="customers", render: renderCustomers },
  { match: ({ parts }) => parts[0]==="customers"&&parts.length===2, render: renderCustomerDetail },
  { match: ({ route }) => route==="products", render: renderProducts },
  { match: ({ parts }) => parts[0]==="products"&&parts.length===2, render: renderProductDetail },
  { match: ({ route }) => route==="categories", render: renderCategories },
  { match: ({ route }) => route==="brands", render: renderBrands },
  { match: ({ route }) => route==="cities", render: renderCities },
  { match: ({ route }) => route==="orders", render: renderOrders },
  { match: ({ parts }) => parts[0] === "orders" && parts.length === 2, render: renderOrderDetail },
  { match: ({ route }) => route==="subscriptions", render: renderSubscriptions },
  { match: ({ route }) => route==="commissions", render: renderCommissions },
  { match: ({ route }) => route==="returns", render: renderReturns },
  { match: ({ route }) => route==="refunds", render: renderRefunds },
  { match: ({ route }) => route==="reviews", render: renderReviews },
  { match: ({ route }) => route==="support", render: renderSupport },
  { match: ({ parts }) => parts[0]==="support"&&parts.length===2, render: renderSupportDetail },
  { match: ({ route }) => route==="imports", render: renderImports },
  { match: ({ route }) => route==="notifications", render: renderNotifications },
  { match: ({ route }) => route==="reports", render: renderReports },
];
