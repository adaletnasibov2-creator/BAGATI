import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  createPrismaPublicProductCatalogClient,
  decodeProductCatalogCursor,
  findPublicProductCatalogPage,
  publicProductCatalogCandidateWhere,
  type PublicProductCatalogFilters,
  type PublicProductCatalogQuery,
} from "../lib/public-product-catalog";
import {
  createPrismaPublicStoreDiscoveryClient,
  decodeStoreDiscoveryCursor,
  findPublicStoreDiscoveryCursorPage,
  type PublicStoreDiscoveryClient,
  type PublicStoreDiscoveryQuery,
} from "../lib/public-store-discovery";
import { listCustomerOrderPage, decodeCustomerOrderCursor } from "../lib/customer-order-pagination";
import { requirePaginationTestUrl, verifyPaginationTestDatabase } from "./pagination-postgres-safety";

const databaseUrl = requirePaginationTestUrl();
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
const productInclude = { store: { select: { id: true, name: true } } } satisfies Prisma.ProductInclude;
const tag = randomUUID().replace(/-/g, "").slice(0, 12);

test("PostgreSQL pagination honors tuple order, sparse-work continuation, stale boundaries, and ownership", { timeout: 180_000 }, async () => {
  const identity = await verifyPaginationTestDatabase(prisma, databaseUrl);
  assert.equal(identity.databaseName, "bagati_pagination_test");
  assert.equal(identity.roleName, "bagati_pagination_runner");

  const userIds: string[] = [];
  const vendorProfileIds: string[] = [];
  const storeIds: string[] = [];
  const productIds: string[] = [];
  const orderIds: string[] = [];
  let cityId: string | undefined;
  let categoryId: string | undefined;

  try {
    const city = await prisma.city.create({ data: { name: `Pagination ${tag}`, slug: `pagination-${tag}` } });
    cityId = city.id;
    const category = await prisma.category.create({ data: { name: `Pagination ${tag}`, slug: `pagination-${tag}` } });
    categoryId = category.id;

    const customer = await prisma.user.create({ data: { email: `pagination-customer-${tag}@test.invalid`, passwordHash: "test-only-not-a-credential", role: "CUSTOMER", emailVerifiedAt: new Date() } });
    userIds.push(customer.id);
    const otherCustomer = await prisma.user.create({ data: { email: `pagination-other-${tag}@test.invalid`, passwordHash: "test-only-not-a-credential", role: "CUSTOMER", emailVerifiedAt: new Date() } });
    userIds.push(otherCustomer.id);
    const validSellerUser = await prisma.user.create({ data: { email: `pagination-seller-${tag}@test.invalid`, passwordHash: "test-only-not-a-credential", role: "VENDOR", emailVerifiedAt: new Date() } });
    userIds.push(validSellerUser.id);
    const sparseSellerUser = await prisma.user.create({ data: { email: `pagination-sparse-${tag}@test.invalid`, passwordHash: "test-only-not-a-credential", role: "VENDOR", emailVerifiedAt: new Date() } });
    userIds.push(sparseSellerUser.id);
    const validVendor = await prisma.vendorProfile.create({ data: { userId: validSellerUser.id, displayName: `Pagination ${tag}`, sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: `Pagination Seller ${tag}`, voen: "1234567890" } });
    vendorProfileIds.push(validVendor.id);
    const sparseVendor = await prisma.vendorProfile.create({ data: { userId: sparseSellerUser.id, displayName: `Sparse ${tag}`, sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: "   ", voen: " " } });
    vendorProfileIds.push(sparseVendor.id);

    const timestamp = new Date("2026-01-01T00:00:00.000Z");
    const sparseStores = Array.from({ length: 505 }, (_, index) => ({
      id: `pg-${tag}-bad-store-${String(index).padStart(4, "0")}`,
      vendorId: sparseVendor.id,
      cityId: city.id,
      name: `A-${String(index).padStart(4, "0")}`,
      slug: `pg-${tag}-bad-store-${String(index).padStart(4, "0")}`,
      status: "ACTIVE" as const,
      isActive: true,
      legalInfoApproved: true,
      adminManaged: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    const eligibleStores = Array.from({ length: 3 }, (_, index) => ({
      id: `pg-${tag}-good-store-${index}`,
      vendorId: validVendor.id,
      cityId: city.id,
      name: "Z-Tied eligible store",
      slug: `pg-${tag}-good-store-${index}`,
      status: "ACTIVE" as const,
      isActive: true,
      legalInfoApproved: true,
      adminManaged: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    storeIds.push(...sparseStores.map(({ id }) => id), ...eligibleStores.map(({ id }) => id));
    await prisma.store.createMany({ data: [...sparseStores, ...eligibleStores] });

    const sparseProducts = sparseStores.map((store, index) => ({
      id: `pg-${tag}-bad-product-${String(index).padStart(4, "0")}`,
      storeId: store.id,
      categoryId,
      name: `A sparse product ${String(index).padStart(4, "0")}`,
      slug: `pg-${tag}-bad-product-${String(index).padStart(4, "0")}`,
      price: "1.00",
      status: "ACTIVE" as const,
      images: [] as string[],
      createdAt: new Date(Date.UTC(2030, 0, 1) + index * 1000),
      updatedAt: timestamp,
    }));
    const eligibleProducts = eligibleStores.map((store, index) => ({
      id: `pg-${tag}-good-product-${index}`,
      storeId: store.id,
      categoryId,
      name: "Tie product",
      slug: `pg-${tag}-good-product-${index}`,
      price: "1.00",
      status: "ACTIVE" as const,
      images: [] as string[],
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
      updatedAt: timestamp,
    }));
    productIds.push(...sparseProducts.map(({ id }) => id), ...eligibleProducts.map(({ id }) => id));
    await prisma.product.createMany({ data: [...sparseProducts, ...eligibleProducts] });

    const orderTime = new Date("2026-02-03T04:05:06.000Z");
    const customerOrders = Array.from({ length: 7 }, (_, index) => ({
      id: `pg-${tag}-order-${String(index).padStart(2, "0")}`,
      userId: customer.id,
      status: "PENDING" as const,
      subtotal: "1.00",
      total: "1.00",
      addressSnapshot: { fixture: tag },
      createdAt: orderTime,
    }));
    const otherOrder = { id: `pg-${tag}-other-order`, userId: otherCustomer.id, status: "PENDING" as const, subtotal: "1.00", total: "1.00", addressSnapshot: { fixture: tag }, createdAt: orderTime };
    for (const data of [...customerOrders, otherOrder]) {
      const order = await prisma.order.create({ data });
      orderIds.push(order.id);
    }

    const expectedOrders = customerOrders.map(({ id }) => id).sort().reverse();
    const orderPages: Array<{ items: Array<{ id: string }>; nextCursor: string | null; previousCursor: string | null }> = [];
    let orderCursor: string | undefined;
    for (let pageIndex = 0; pageIndex < 8; pageIndex += 1) {
      const page = await listCustomerOrderPage(prisma, customer.id, { pageSize: 2, ...(orderCursor ? { cursor: orderCursor } : {}) });
      orderPages.push(page);
      orderCursor = page.nextCursor ?? undefined;
      if (!orderCursor) break;
    }
    const traversedOrders = orderPages.flatMap(({ items }) => items.map(({ id }) => id));
    assert.deepEqual(traversedOrders, expectedOrders);
    assert.equal(new Set(traversedOrders).size, customerOrders.length);
    assert.ok(orderPages[1]?.previousCursor);
    const orderBack = await listCustomerOrderPage(prisma, customer.id, { pageSize: 2, cursor: orderPages[1]!.previousCursor! });
    assert.deepEqual(orderBack.items.map(({ id }) => id), expectedOrders.slice(0, 2));

    const firstOrderPage = await listCustomerOrderPage(prisma, customer.id, { pageSize: 2 });
    const deletedOrderCursor = decodeCustomerOrderCursor(firstOrderPage.nextCursor!)!;
    await prisma.order.delete({ where: { id: deletedOrderCursor.id } });
    const afterDeletedOrderCursor = await listCustomerOrderPage(prisma, customer.id, { pageSize: 2, cursor: firstOrderPage.nextCursor! });
    assert.deepEqual(afterDeletedOrderCursor.items.map(({ id }) => id), expectedOrders.slice(2, 4));

    const productPage = (sort: "name" | "newest", cursor?: string, filters: PublicProductCatalogFilters = {}) => prisma.$transaction(
      (tx) => findPublicProductCatalogPage(createPrismaPublicProductCatalogClient(tx, productInclude), filters, {
        sort, limit: 2, paginate: true, maxScanRows: 500, ...(cursor ? { cursor } : {}),
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    let requestedForSparseProductPage = 0;
    const firstSparseProductPage = await prisma.$transaction(async (tx) => {
      const base = createPrismaPublicProductCatalogClient(tx, productInclude);
      const measured = {
        findCandidates: (query: PublicProductCatalogQuery) => { requestedForSparseProductPage += query.take; return base.findCandidates(query); },
        findRecords: (ids: string[]) => base.findRecords(ids),
      };
      return findPublicProductCatalogPage(measured, {}, { sort: "newest", limit: 2, paginate: true, maxScanRows: 500 });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    assert.deepEqual(firstSparseProductPage.items, []);
    assert.equal(requestedForSparseProductPage, 501, "one request should scan at most 500 candidates plus one probe");
    assert.ok(firstSparseProductPage.nextCursor);
    const secondSparseProductPage = await productPage("newest", firstSparseProductPage.nextCursor!);
    const eligibleFixtureCandidates = await createPrismaPublicProductCatalogClient(prisma, productInclude).findCandidates({
      where: { AND: [publicProductCatalogCandidateWhere({}, new Date()), { id: { in: eligibleProducts.map(({ id }) => id) } }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10,
    });
    assert.deepEqual(
      secondSparseProductPage.items.map(({ id }) => id),
      [eligibleProducts[2]!.id, eligibleProducts[1]!.id],
      `expected eligible fixtures; candidate count=${eligibleFixtureCandidates.length}, candidates=${eligibleFixtureCandidates.map((item) => `${item.id}:${item.status}:${item.store.status}:${item.store.isActive}:${item.store.legalInfoApproved}:${item.store.city.isActive}:${item.store.vendor.user.isActive}:${item.store.vendor.legalName?.trim() ? "legal-name" : "no-legal-name"}:${item.store.vendor.voen?.trim() ? "voen" : "no-voen"}:${item.store.adminManaged}`).join(",")}`,
    );
    assert.ok(secondSparseProductPage.nextCursor);
    await prisma.store.update({ where: { id: eligibleStores[1]!.id }, data: { isActive: false } });
    const afterIneligibleProductCursor = await productPage("newest", secondSparseProductPage.nextCursor!);
    assert.deepEqual(afterIneligibleProductCursor.items.map(({ id }) => id), [eligibleProducts[0]!.id]);

    await prisma.store.update({ where: { id: eligibleStores[1]!.id }, data: { isActive: true } });
    const productNameFilter = { query: "Tie product", searchFields: "name" as const };
    const filteredNameFirst = await productPage("name", undefined, productNameFilter);
    assert.deepEqual(filteredNameFirst.items.map(({ id }) => id), [eligibleProducts[0]!.id, eligibleProducts[1]!.id]);
    assert.ok(filteredNameFirst.nextCursor);
    const filteredNameSecond = await productPage("name", filteredNameFirst.nextCursor!, productNameFilter);
    assert.deepEqual(filteredNameSecond.items.map(({ id }) => id), [eligibleProducts[2]!.id]);
    assert.ok(filteredNameSecond.previousCursor);
    const filteredNameBack = await productPage("name", filteredNameSecond.previousCursor!, productNameFilter);
    assert.deepEqual(filteredNameBack.items.map(({ id }) => id), [eligibleProducts[0]!.id, eligibleProducts[1]!.id]);

    const firstNameScanPage = await productPage("name");
    assert.deepEqual(firstNameScanPage.items, [], "the bounded first page must not scan beyond 500 ineligible name-sorted candidates");
    assert.ok(firstNameScanPage.nextCursor, "the bounded empty page must expose a forward continuation");
    const nameSortedPage = await productPage("name", firstNameScanPage.nextCursor);
    assert.deepEqual(nameSortedPage.items.map(({ id }) => id), [eligibleProducts[0]!.id, eligibleProducts[1]!.id]);
    assert.ok(nameSortedPage.nextCursor);
    await prisma.product.delete({ where: { id: eligibleProducts[1]!.id } });
    const afterDeletedProductCursor = await productPage("name", nameSortedPage.nextCursor!);
    assert.deepEqual(afterDeletedProductCursor.items.map(({ id }) => id), [eligibleProducts[2]!.id]);

    const storePage = (cursor?: string, filters: { citySlug?: string | null; query?: string | null } = {}) => prisma.$transaction(
      (tx) => findPublicStoreDiscoveryCursorPage(createPrismaPublicStoreDiscoveryClient(tx), filters, {
        pageSize: 2, maxScanRows: 500, ...(cursor ? { cursor } : {}),
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const tiedStoresFirst = await storePage(undefined, { query: "Z-Tied eligible store" });
    assert.deepEqual(tiedStoresFirst.items.map(({ id }) => id), [eligibleStores[0]!.id, eligibleStores[1]!.id]);
    assert.ok(tiedStoresFirst.nextCursor);
    const tiedStoresSecond = await storePage(tiedStoresFirst.nextCursor!, { query: "Z-Tied eligible store" });
    assert.deepEqual(tiedStoresSecond.items.map(({ id }) => id), [eligibleStores[2]!.id]);
    assert.ok(tiedStoresSecond.previousCursor);
    const tiedStoresBack = await storePage(tiedStoresSecond.previousCursor!, { query: "Z-Tied eligible store" });
    assert.deepEqual(tiedStoresBack.items.map(({ id }) => id), [eligibleStores[0]!.id, eligibleStores[1]!.id]);

    let requestedForSparseStorePage = 0;
    const firstSparseStorePage = await prisma.$transaction(async (tx) => {
      const base = createPrismaPublicStoreDiscoveryClient(tx);
      const measured: PublicStoreDiscoveryClient = {
        findCandidates: (query: PublicStoreDiscoveryQuery) => { requestedForSparseStorePage += query.take; return base.findCandidates(query); },
        findStoresByIds: (ids) => base.findStoresByIds(ids),
      };
      return findPublicStoreDiscoveryCursorPage(measured, {}, { pageSize: 2, maxScanRows: 500 });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    assert.deepEqual(firstSparseStorePage.items, []);
    assert.equal(requestedForSparseStorePage, 501, "one request should scan at most 500 candidates plus one probe");
    assert.ok(firstSparseStorePage.nextCursor);
    const secondSparseStorePage = await storePage(firstSparseStorePage.nextCursor!);
    assert.deepEqual(secondSparseStorePage.items.map(({ id }) => id), [eligibleStores[0]!.id, eligibleStores[1]!.id]);
    assert.ok(secondSparseStorePage.nextCursor);
    await prisma.store.update({ where: { id: eligibleStores[1]!.id }, data: { isActive: false } });
    const afterIneligibleStoreCursor = await storePage(secondSparseStorePage.nextCursor!);
    assert.deepEqual(afterIneligibleStoreCursor.items.map(({ id }) => id), [eligibleStores[2]!.id]);

    assert.equal(decodeProductCatalogCursor(firstSparseProductPage.nextCursor!)?.direction, "after");
    assert.equal(decodeStoreDiscoveryCursor(firstSparseStorePage.nextCursor!)?.direction, "after");
  } finally {
    if (orderIds.length) await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    if (storeIds.length) await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
    if (vendorProfileIds.length) await prisma.vendorProfile.deleteMany({ where: { id: { in: vendorProfileIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
    if (cityId) await prisma.city.deleteMany({ where: { id: cityId } });
    await prisma.$disconnect();
  }
});
