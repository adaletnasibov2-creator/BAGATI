import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import AdminMutationForm, { type AdminField } from "@/components/admin-mutation-form";
import AdminStoreProfileForm from "@/components/admin-store-profile-form";
import AdminStoreActivationAction from "@/components/admin-store-activation-action";
import AdminStoreArchiveAction from "@/components/admin-store-archive-action";
import AdminStoreReadiness from "@/components/admin-store-readiness";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { summarizeDeliveredSales } from "@/lib/admin-sales-report";
import { summarizeMonthlyStoreSales } from "@/lib/store-monthly-sales";
import { formatLocalDateInput, parseLocalDateRange } from "@/lib/admin-report-dates";
import { allowedAdminOrderTransitions } from "@/lib/order-fulfillment";
import AdminSiteSettingsForm from "@/components/admin-site-settings-form";
import AdminSettingsTabs from "@/components/admin-settings-tabs";
import AdminSettingField from "@/components/admin-setting-field";
import { loadAdminSettingsGroup, loadSettingSummary } from "@/lib/settings/admin";
import { SETTING_KEYS } from "@/lib/settings/registry";
import { commissionRateToPercent } from "@/lib/commission-rules";
import AdminHomepageManager from "@/components/admin-homepage-manager";
import AdminProductEditForm from "@/components/admin-product-edit-form";
import AdminPromotionManager from "@/components/admin-promotion-manager";
import AdminSubscriptionManager from "@/components/admin-subscription-manager";
import AdminProductImport from "@/components/admin-product-import";
import { SITE_SETTINGS_DEFAULTS } from "@/lib/site-content";
import { categoriesWithOtherLast } from "@/lib/category-order";
import { normalizeAdminEnumFilter, normalizeAdminPage, normalizeAdminSearch, normalizeAdminSearchParams } from "@/lib/admin-pagination";
import { missingSellerLegalFields } from "@/lib/seller-legal-policy";
import { complimentaryFromRows, resolveStoreEntitlements } from "@/lib/subscription-entitlements";
import { complimentaryGrantView, complimentaryHistorySelect } from "@/lib/complimentary-entitlements";
import AdminComplimentaryManager from "@/components/admin-complimentary-manager";
import { buildAdminStoreReadiness } from "@/lib/admin-store-readiness";
import { storeProfileOptions, toAdminStoreProfileView } from "@/lib/admin-store-profile";
import { Filters, FilterSelect } from "@/components/admin-list-filters";
import { adminOrderStatusWhere, ADMIN_PENDING_ORDER_GROUP } from "@/lib/admin-order-filters";

import { type SectionContext, card, storeStatuses, orderStatuses, productStatuses, Header, formatStoreCityName, formatSubscriptionSummary, Table, Pager, StatusForm } from "../_sections/shared";
import { ADMIN_SECTIONS } from "../_sections";

export const dynamic="force-dynamic";
const db:any=prisma;

export default async function AdminSectionPage({params,searchParams}:{params:Promise<{section:string[]}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const admin=await requireRole("ADMIN");if(!admin)redirect("/admin/login");
 const [{section:parts},rawSearchParams]=await Promise.all([params,searchParams]);const sp=normalizeAdminSearchParams(rawSearchParams);const route=parts.join("/");const q=normalizeAdminSearch(sp.q);const page=normalizeAdminPage(sp.page);const take=25,skip=(page-1)*take;const pageQuery=new URLSearchParams(Object.entries(sp).filter(([k,v])=>k!=="page"&&Boolean(v)) as [string,string][]).toString();
 const shell=(content:React.ReactNode)=><AdminShell email={admin.email}>{content}</AdminShell>;
 // Sections moved to app/admin/_sections/* (original order); the branches below are not moved yet.
 const ctx:SectionContext={admin,parts,route,sp,q,page,take,skip,pageQuery,shell};
 for(const section of ADMIN_SECTIONS)if(section.match(route,parts))return section.render(ctx);














 notFound();
}
