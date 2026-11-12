import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Prisma } from "@prisma/client";
import { planEntitlements, resolveStoreEntitlements } from "../lib/subscription-entitlements";
import { publicStoreWhere } from "../lib/seller-legal-policy";
import { adminStoreVisibilityMutation, publicProductVisibilityWhere, publicStoreListingWhere, publicStoreVisibilityWhere } from "../lib/store-visibility";
import { getStoreDeletionBlockers } from "../lib/admin-store-deletion";
import { getProductPublicationBlockers, getStorePublicationBlockers, publishEligibleDraftProducts, type DraftProductCandidate } from "../lib/admin-store-product-publishing";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const adminRoute = readFileSync(resolve(root, "app/api/admin/[...resource]/route.ts"), "utf8");
const adminPage = readFileSync(resolve(root, "app/admin/[...section]/page.tsx"), "utf8");
const adminRoutePage = adminPage;
const archiveRoute = readFileSync(resolve(root, "app/api/admin/stores/[storeId]/archive/route.ts"), "utf8");
const deleteStoreRoute = readFileSync(resolve(root, "app/api/admin/stores/[storeId]/route.ts"), "utf8");
const activationRoute = readFileSync(resolve(root, "app/api/admin/stores/[storeId]/activation/route.ts"), "utf8");
const activationAction = readFileSync(resolve(root, "components/admin-store-activation-action.tsx"), "utf8");
// The review route delegates its transaction to lib/store-review-transaction.ts; check both together.
const reviewRoute = readFileSync(resolve(root, "app/api/admin/stores/[storeId]/review/route.ts"), "utf8") + "\n" + readFileSync(resolve(root, "lib/store-review-transaction.ts"), "utf8");
const vendorStoreRoute = readFileSync(resolve(root, "app/api/vendor/[storeId]/[section]/route.ts"), "utf8");
const vendorOverview = readFileSync(resolve(root, "app/vendor/[storeId]/page.tsx"), "utf8");

test("admin-created stores are attributed and do not get a subscription record", () => {
  const createdStoreHandler = adminRoute.split('if (section === "stores")')[1]?.split("\n  return NextResponse.json")[0] ?? "";
  assert.match(createdStoreHandler, /managementReason: z\.string\(\)\.trim\(\)\.min\(8\)/);
  assert.match(createdStoreHandler, /adminManaged:\s*true/);
  assert.match(createdStoreHandler, /managedByAdminId:\s*admin\.id/);
  assert.match(createdStoreHandler, /managementReason:\s*parsed\.data\.managementReason/);
  assert.match(createdStoreHandler, /isActive:\s*parsed\.data\.isActive/);
  assert.match(createdStoreHandler, /ADMIN_MANAGED_STORE_CREATE/);
  assert.match(adminPage, /name:"isActive",label:"İlkin aktivlik/);
  assert.doesNotMatch(createdStoreHandler, /subscription:\s*\{\s*create:/);
  assert.match(adminPage, /Admin tərəfindən · ödənişsiz/);
  assert.match(adminPage, /Admin idarəçiliyinin səbəbi/);
});

test("admin-managed entitlement is BASIC-only and paid subscription eligibility is unchanged", () => {
  const managed = resolveStoreEntitlements({
    adminManaged: true,
    storeStatus: "ACTIVE",
    storeActive: true,
    vendorActive: true,
    cityActive: true,
    subscriptionStatus: null,
    planSlug: null,
    planActive: false,
    periodEnd: null,
    complimentary: null,
  });
  assert.equal(managed.eligible, true);
  assert.equal(managed.plan, "BASIC");
  assert.equal(managed.limits, planEntitlements.BASIC);
  assert.equal(resolveStoreEntitlements({
    adminManaged: false,
    storeStatus: "ACTIVE",
    storeActive: true,
    vendorActive: true,
    cityActive: true,
    subscriptionStatus: null,
    planSlug: null,
    planActive: false,
    periodEnd: null,
    complimentary: null,
  }).eligible, false);
  const now = new Date("2026-10-20T12:00:00.000Z");
  assert.deepEqual(publicStoreWhere(now).OR?.[1], {
    subscription: {
      is: {
        status: "ACTIVE",
        AND: [
          { OR: [{ currentPeriodStart: null }, { currentPeriodStart: { lte: now } }] },
          { OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }] },
        ],
        plan: { isActive: true, slug: { in: ["basic", "pro", "professional"], mode: "insensitive" } },
      },
    },
  });
});

test("store archival is soft and leaves historical orders and reporting relations attached", () => {
  assert.match(archiveRoute, /data: STORE_ARCHIVE_UPDATE/);
  assert.doesNotMatch(archiveRoute, /\.store\.delete(?:Many)?\(/);
  assert.match(adminPage, /storeOrder\.aggregate\(\{where:\{storeId:id,status:"DELIVERED"\}/);
  assert.match(adminPage, /storeOrders:\{take:12/);
});

test("permanent store deletion is restricted to stores without business history and is audited", () => {
  const empty = { products: 0, storeOrders: 0, promotions: 0, commissions: 0, notifications: 0, returnRequests: 0, productImports: 0, hasSubscription: false };
  assert.deepEqual(getStoreDeletionBlockers(empty), []);
  assert.ok(getStoreDeletionBlockers({ ...empty, storeOrders: 1 }).includes("storeOrders"));
  assert.ok(getStoreDeletionBlockers({ ...empty, returnRequests: 1 }).includes("returnRequests"));
  assert.ok(getStoreDeletionBlockers({ ...empty, productImports: 1 }).includes("productImports"));
  assert.ok(getStoreDeletionBlockers({ ...empty, hasSubscription: true }).includes("subscription"));
  assert.match(deleteStoreRoute, /const admin = await requireRole\("ADMIN"\)/);
  assert.match(deleteStoreRoute, /TransactionIsolationLevel\.Serializable/);
  assert.match(deleteStoreRoute, /STORE_PERMANENT_DELETE/);
  assert.match(deleteStoreRoute, /historyPreserved: true/);
});

test("admin activation explicitly controls public visibility without changing sale eligibility", () => {
  assert.equal(adminStoreVisibilityMutation("SUSPENDED", true), null);
  assert.equal(adminStoreVisibilityMutation("REJECTED", true), null);
  assert.equal(adminStoreVisibilityMutation("DRAFT", true), null);
  assert.equal(adminStoreVisibilityMutation("PENDING_REVIEW", true), null);
  const activate = adminStoreVisibilityMutation("ACTIVE", true);
  assert.deepEqual(activate, { isActive: true });
  const deactivate = adminStoreVisibilityMutation("ACTIVE", false);
  assert.deepEqual(deactivate, { isActive: false });

  const now = new Date("2026-10-20T12:00:00.000Z");
  const visibilityWhere = publicStoreVisibilityWhere(now);
  const saleWhere = publicStoreWhere(now);
  assert.deepEqual(visibilityWhere, saleWhere);
  assert.match(JSON.stringify(visibilityWhere), /legalInfoApproved|subscription|vendor|city/);
  assert.deepEqual(publicProductVisibilityWhere(undefined, now), { status: "ACTIVE", store: visibilityWhere });
  assert.doesNotMatch(JSON.stringify(publicProductVisibilityWhere()), /inventory/);
  assert.deepEqual(publicProductVisibilityWhere({ city: { slug: "qazax" } }, now), {
    status: "ACTIVE",
    store: { AND: [visibilityWhere, { city: { slug: "qazax" } }] },
  });

  test("store search filters preserve the public subscription or admin-managed eligibility condition", () => {
    const now = new Date("2026-10-20T12:00:00.000Z");
    const base = publicStoreVisibilityWhere(now);
    const filtered = publicStoreListingWhere({ citySlug: "qazax", query: "test" }, now);

    assert.deepEqual(filtered.OR, base.OR);
    assert.deepEqual(filtered.AND, [
      { city: { isActive: true, slug: "qazax" } },
      { OR: [
        { name: { contains: "test", mode: "insensitive" } },
        { description: { contains: "test", mode: "insensitive" } },
      ] },
    ]);
    assert.match(readFileSync(resolve(root, "app/(customer)/stores/page.tsx"), "utf8"), /findPublicStoreDiscoveryCursorPage\([\s\S]*\{ citySlug: city, query: q \}/);
    assert.match(readFileSync(resolve(root, "lib/public-store-discovery.ts"), "utf8"), /publicStoreListingCandidateWhere/);
    assert.match(readFileSync(resolve(root, "lib/public-store-discovery.ts"), "utf8"), /isPublicStoreEligible/);
    assert.match(readFileSync(resolve(root, "app/api/stores/route.ts"), "utf8"), /publicStoreListingWhere\(\{ citySlug: city \}\)/);
  });
  assert.match(JSON.stringify(saleWhere), /legalInfoApproved/);
  assert.match(JSON.stringify(saleWhere), /subscription/);

  assert.match(activationRoute, /requireRole\("ADMIN"\)/);
  assert.match(activationRoute, /adminStoreVisibilityMutation/);
  assert.match(activationRoute, /if \(!visibilityUpdate\) return \{ kind: "NOT_APPROVED"/);
  assert.match(activationRoute, /result\.kind === "NOT_APPROVED".*status: 409/);
  assert.match(activationRoute, /reason: z\.string\(\)\.trim\(\)\.min\(3\)/);
  assert.match(activationRoute, /STORE_ACTIVATE/);
  assert.match(activationRoute, /STORE_DEACTIVATE/);
  assert.match(activationRoute, /previousStatus: store\.status/);
  assert.match(activationRoute, /nextStatus: store\.status/);
  assert.match(activationRoute, /actorId: admin\.id/);
  assert.match(activationRoute, /getStorePublicationBlockers/);
  assert.match(activationRoute, /publishEligibleDraftProducts/);
  assert.match(reviewRoute, /resolveStoreEntitlements/);
  assert.match(reviewRoute, /isActive: activationBlockers\.length === 0/);
  assert.match(reviewRoute, /publishEligibleDraftProducts/);
  assert.match(activationAction, /\/activation/);
  assert.match(activationAction, /reason: reason\.trim\(\)/);
  assert.match(adminPage, /AdminStoreActivationAction storeId=\{r\.id\}/);
});

test("store publication blockers include legal approval and verified seller requirements", () => {
  const now = new Date("2026-10-20T12:00:00.000Z");
  const blockers = getStorePublicationBlockers({
    status: "ACTIVE",
    isActive: true,
    legalInfoApproved: false,
    adminManaged: false,
    vendorActive: true,
    cityActive: true,
    sellerType: null,
    legalName: null,
    voen: null,
    legalAddress: null,
    subscriptionStatus: "ACTIVE",
    planSlug: "basic",
    planActive: true,
    periodStart: new Date("2026-10-01T00:00:00.000Z"),
    periodEnd: new Date("2026-11-01T00:00:00.000Z"),
    complimentary: null,
  }, now);

  assert.ok(blockers.some((reason) => reason.includes("Satıcı növü")));
  assert.ok(blockers.some((reason) => reason.includes("VÖEN")));
  assert.ok(blockers.some((reason) => reason.includes("təsdiqlənməyib")));

  const eligible = getStorePublicationBlockers({
    status: "ACTIVE",
    isActive: true,
    legalInfoApproved: true,
    adminManaged: false,
    vendorActive: true,
    cityActive: true,
    sellerType: "INDIVIDUAL_ENTREPRENEUR",
    legalName: "Seller Name",
    voen: "1234567890",
    legalAddress: null,
    subscriptionStatus: "ACTIVE",
    planSlug: "basic",
    planActive: true,
    periodStart: new Date("2026-10-01T00:00:00.000Z"),
    periodEnd: new Date("2026-11-01T00:00:00.000Z"),
    complimentary: null,
  }, now);
  assert.deepEqual(eligible, []);

  const vendorPage = readFileSync(resolve(root, "app/vendor/page.tsx"), "utf8");
  assert.match(vendorPage, /getStorePublicationBlockers/);
  assert.match(vendorPage, /Yayımlanma tələbləri tamamlanmayıb/);

  assert.match(vendorOverview, /getStorePublicationBlockers/);
  assert.match(vendorOverview, /İctimai görünürlük aktivdir/);
  assert.match(vendorOverview, /İctimai satışa hazır deyil/);
  assert.match(vendorOverview, /readinessBlockers\.map/);
  assert.doesNotMatch(vendorOverview, /store\.isActive \? "Satış aktivdir"/);
});

test("draft publication validates product fields and stock without rejecting legitimate zero stock", () => {
  const product: DraftProductCandidate = {
    id: "product-1",
    name: "Test Köynək",
    description: null,
    price: "10.00",
    discountPrice: null,
    categoryId: "category-1",
    category: { isActive: true },
    inventory: [{ variantId: null, quantity: 0, reserved: 0 }],
    variants: [],
  };
  assert.deepEqual(getProductPublicationBlockers(product), []);
  assert.ok(getProductPublicationBlockers({
    ...product,
    name: " ",
    price: "0",
    category: { isActive: false },
    inventory: [{ variantId: null, quantity: -1, reserved: 2 }],
  }).length >= 4);
});

test("eligible draft publication is conditional, audited once, and reports blocked drafts", async () => {
  const candidate: DraftProductCandidate = {
    id: "product-1",
    name: "Test Köynək",
    description: null,
    price: "10.00",
    discountPrice: null,
    categoryId: "category-1",
    category: { isActive: true },
    inventory: [{ variantId: null, quantity: 1, reserved: 0 }],
    variants: [],
  };
  const updates: unknown[] = [];
  const audits: unknown[] = [];
  let queryWhere: unknown;
  let productStatus = "DRAFT";
  const tx = {
    $queryRaw: async () => [],
    product: {
      findMany: async (args: { where: unknown }) => {
        queryWhere = args.where;
        return productStatus === "DRAFT" ? [candidate] : [];
      },
      count: async () => 0,
      updateMany: async (args: unknown) => {
        updates.push(args);
        productStatus = "ACTIVE";
        return { count: 1 };
      },
    },
    auditLog: { create: async (args: unknown) => { audits.push(args); } },
  } as unknown as Prisma.TransactionClient;
  const result = await publishEligibleDraftProducts(tx, {
    storeId: "store-1",
    actorId: "admin-1",
    plan: "BASIC",
    storeBlockers: [],
    reason: "Store activated",
  });
  assert.deepEqual(queryWhere, { storeId: "store-1", status: "DRAFT" });
  assert.equal(result.totalDrafts, 1);
  assert.deepEqual(result.published, [{ id: "product-1", name: "Test Köynək" }]);
  assert.deepEqual(result.skipped, []);
  assert.equal(updates.length, 1);
  assert.equal(audits.length, 1);
  assert.deepEqual(updates[0], {
    where: { id: "product-1", storeId: "store-1", status: "DRAFT" },
    data: { status: "ACTIVE" },
  });
  const repeated = await publishEligibleDraftProducts(tx, {
    storeId: "store-1",
    actorId: "admin-1",
    plan: "BASIC",
    storeBlockers: [],
  });
  assert.equal(repeated.totalDrafts, 0);
  assert.equal(audits.length, 1);

  const blockedTx = {
    $queryRaw: async () => [],
    product: {
      findMany: async () => [candidate],
      count: async () => 0,
      updateMany: async () => { throw new Error("blocked product must not be updated"); },
    },
    auditLog: { create: async () => { throw new Error("blocked product must not be audited as published"); } },
  } as unknown as Prisma.TransactionClient;
  const blocked = await publishEligibleDraftProducts(blockedTx, {
    storeId: "store-1",
    actorId: "admin-1",
    plan: null,
    storeBlockers: ["Abunəlik tələb olunur."],
  });
  assert.deepEqual(blocked.published, []);
  assert.deepEqual(blocked.skipped[0]?.reasons, ["Abunəlik tələb olunur."]);
});

test("admin store detail shows valid Azerbaijani labels and explains automatic draft publishing", () => {
  assert.match(adminPage, /\u0130ctimai g\u00f6r\u00fcn\u00fcrl\u00fck/);
  assert.match(adminPage, /H\u00fcquqi bax\u0131\u015f/);
  assert.match(adminPage, /Tamamlanmay\u0131b/);
  assert.match(adminPage, /Ma\u011faza aktivl\u0259\u015fdiril\u0259nd\u0259 yayımlanma tələblərinə cavab verən qaralama məhsullar avtomatik yayımlanır/);
  assert.match(activationAction, /Ma\u011faza dayand\u0131r\u0131l\u0131b\. G\u00f6r\u00fcn\u00fcrl\u00fcy\u00fc birba\u015fa aktiv etm\u0259k olmaz/);
});

test("public discovery, cart, and checkout share current store and product eligibility", () => {
  assert.match(readFileSync(resolve(root, "app/(customer)/stores/page.tsx"), "utf8"), /findPublicStoreDiscoveryCursorPage/);
  assert.match(readFileSync(resolve(root, "app/api/stores/route.ts"), "utf8"), /publicStoreListingWhere/);
  const visibility = readFileSync(resolve(root, "lib/store-visibility.ts"), "utf8");
  assert.match(visibility, /export function publicStoreVisibilityWhere\(now = new Date\(\)\)/);
  assert.match(visibility, /return publicStoreWhere\(now\)/);
  assert.match(readFileSync(resolve(root, "lib/public-store-map.ts"), "utf8"), /publicStoreVisibilityWhere/);
  for (const path of ["app/api/cart/route.ts", "app/api/cart/items/route.ts", "app/api/cart/items/[itemId]/route.ts", "app/api/orders/route.ts"]) {
    assert.match(readFileSync(resolve(root, path), "utf8"), /resolvePublicProductEligibility/);
  }
  const storefront = readFileSync(resolve(root, "app/(customer)/stores/[storeId]/page.tsx"), "utf8");
  assert.match(storefront, /OR: \[\{ id: storeId \}, \{ slug: storeId \}\]/);
  const catalog = readFileSync(resolve(root, "lib/public-product-catalog.ts"), "utf8");
  assert.match(catalog, /publicStoreEligibilityBaseWhere/);
  assert.match(catalog, /isPublicStoreEligible/);
  for (const path of ["app/(customer)/products/page.tsx", "app/(customer)/products/[productId]/page.tsx", "app/(customer)/categories/page.tsx", "app/(customer)/new-products/page.tsx", "app/(customer)/deals/page.tsx", "app/(customer)/page.tsx", "app/api/products/route.ts", "app/api/products/[id]/route.ts", "app/(customer)/stores/[storeId]/page.tsx"]) {
    const source = readFileSync(resolve(root, path), "utf8");
    assert.match(source, /publicProductVisibilityWhere|findPublicProductCatalogPage/);
    if (path.startsWith("app/(customer)/")) assert.match(source, /export const dynamic = "force-dynamic"/);
  }
  assert.match(storefront, /publicProductVisibilityWhere\(\{ id: store\.id \}\)/);
});

test("admin-managed stores can enter review without a subscription and retain the chosen activation state", () => {
  const submitHandler = vendorStoreRoute.split('if(section==="submit")')[1]?.split('\n if(section==="products")')[0] ?? "";
  assert.match(submitHandler, /checkStoreSubmission\(\{/);
  assert.match(submitHandler, /adminManaged:store\.adminManaged/);
  assert.match(submitHandler, /hasSubscription:Boolean\(store\.subscription\)/);
  assert.match(submitHandler, /status:"PENDING_REVIEW",isActive:store\.isActive/);
});

test("delete removes history-free stores and archives stores with history instead of rejecting removal", () => {
  assert.match(deleteStoreRoute, /if \(blockers\.length\)/);
  assert.match(deleteStoreRoute, /status: "SUSPENDED", isActive: false/);
  assert.match(deleteStoreRoute, /STORE_DELETE_ARCHIVE/);
  assert.match(deleteStoreRoute, /kind: "ARCHIVED"/);
  assert.doesNotMatch(deleteStoreRoute, /kind: "HAS_HISTORY"/);
  assert.match(adminPage, /AdminStoreArchiveAction storeId=\{r\.id\}/);
  assert.match(adminPage, /NOT:\{status:"SUSPENDED",isActive:false\}/);
});

test("category deletion is limited to unused leaf categories and records an audit event", () => {
  assert.match(adminRoute, /if \(section === "categories"\)[\s\S]*?_count: \{ select: \{ products: true, children: true \} \}/);
  assert.match(adminRoute, /if \(category\._count\.products \|\| category\._count\.children\) return "IN_USE"/);
  assert.match(adminRoute, /CATEGORY_DELETE/);
});

test("admin mutations and store review/archive routes enforce the ADMIN role", () => {
  assert.match(adminRoute, /const admin = await requireRole\("ADMIN"\)/);
  assert.match(readFileSync(resolve(root, "app/api/admin/stores/[storeId]/review/route.ts"), "utf8"), /const admin = await requireRole\("ADMIN"\)/);
  assert.match(archiveRoute, /const admin = await requireRole\("ADMIN"\)/);
});

test("admin order UI and API use only supported fulfillment transitions", () => {
  assert.match(adminRoute, /const fulfillmentStatuses = VENDOR_ORDER_STATUSES/);
  assert.match(adminRoutePage, /allowedAdminOrderTransitions\(order\.storeOrders\.map/);
  assert.match(adminRoutePage, /label:"İcazə verilən növbəti status"/);
});

test("admin product publishing preserves public store eligibility and subscription limits", () => {
  assert.match(adminRoute, /category: \{ select: \{ isActive: true \} \}/);
  assert.match(adminRoute, /where: \{ id: current\.storeId, \.\.\.publicStoreWhere\(\) \}/);
  assert.match(adminRoute, /lockStoreEntitlement\(tx, productStore\.storeId\)/);
  assert.match(adminRoute, /SELECT "id" FROM "Product" WHERE "id" = \$\{id\} FOR UPDATE/);
  assert.match(adminRoute, /assertProductLimit\(tx, current\.storeId, entitlement\.plan\)/);
  assert.match(adminRoute, /getProductPublicationBlockers\(current\)/);
});
