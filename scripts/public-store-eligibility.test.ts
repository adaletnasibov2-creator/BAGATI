import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isPublicProductEligible,
  isPublicStoreEligible,
  filterEligiblePublicProducts,
  filterEligiblePublicStores,
  resolvePublicProductEligibility,
  resolvePublicStoreEligibility,
  type PublicStoreCandidate,
  type PublicStoreEligibilityClient,
} from "../lib/public-store-eligibility";

const eligibleStore = (id: string, overrides: Partial<PublicStoreCandidate> = {}): PublicStoreCandidate => ({
  id,
  status: "ACTIVE",
  isActive: true,
  legalInfoApproved: true,
  adminManaged: false,
  city: { isActive: true },
  vendor: {
    user: { isActive: true },
    sellerType: "INDIVIDUAL_ENTREPRENEUR",
    legalName: "Synthetic Seller",
    voen: "1234567890",
    legalAddress: null,
  },
  subscription: {
    status: "ACTIVE",
    currentPeriodStart: null,
    currentPeriodEnd: null,
    plan: { isActive: true, slug: "basic" },
  },
  ...overrides,
});

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function mockClient(stores: PublicStoreCandidate[]) {
  const calls: Array<{ ids: string[]; where: unknown }> = [];
  const client = {
    store: {
      findMany: async (args: Parameters<PublicStoreEligibilityClient["store"]["findMany"]>[0]) => {
        calls.push({ ids: args.where.id.in, where: args.where });
        return stores.filter((store) => args.where.id.in.includes(store.id));
      },
    },
  } satisfies PublicStoreEligibilityClient;
  return { client, calls };
}

test("eligibility uses ECMAScript trim semantics for required values", async () => {
  const blankValues = [null, "", " \t\n", "\u00a0", "\ufeff"];
  const stores = blankValues.map((value, index) => eligibleStore(`blank-${index}`, {
    vendor: { ...eligibleStore("base").vendor, legalName: value },
  }));
  const valid = eligibleStore("valid", {
    vendor: { ...eligibleStore("base").vendor, legalName: "\u00a0Seller Name\ufeff" },
  });
  const client = mockClient([...stores, valid]);

  const eligible = await resolvePublicStoreEligibility([...stores, valid].map((store) => store.id), client.client);

  assert.deepEqual([...eligible], ["valid"]);
});

test("seller type policies, empty overrides, duplicates, and unknown types are applied", async () => {
  const previous = process.env.BAGATI_SELLER_LEGAL_POLICY;
  process.env.BAGATI_SELLER_LEGAL_POLICY = JSON.stringify({
    INDIVIDUAL_ENTREPRENEUR: ["legalName", "legalName"],
    REGISTERED_COMPANY: [],
  });
  try {
    const stores = [
      eligibleStore("individual-valid", { vendor: { ...eligibleStore("base").vendor, voen: null } }),
      eligibleStore("company-empty-policy", { vendor: { ...eligibleStore("base").vendor, sellerType: "REGISTERED_COMPANY", legalName: null, voen: null } }),
      eligibleStore("individual-invalid", { vendor: { ...eligibleStore("base").vendor, legalName: " " } }),
      eligibleStore("unknown-type", { vendor: { ...eligibleStore("base").vendor, sellerType: "UNKNOWN" } }),
    ];
    const client = mockClient(stores);
    const eligible = await resolvePublicStoreEligibility(stores.map((store) => store.id), client.client);
    assert.deepEqual([...eligible].sort(), ["company-empty-policy", "individual-valid"]);
  } finally {
    if (previous === undefined) delete process.env.BAGATI_SELLER_LEGAL_POLICY;
    else process.env.BAGATI_SELLER_LEGAL_POLICY = previous;
  }
});

test("legal approval remains separate from completeness and base public eligibility", async () => {
  const completeButUnapproved = eligibleStore("unapproved", { legalInfoApproved: false });
  const incompleteButApproved = eligibleStore("incomplete", {
    vendor: { ...eligibleStore("base").vendor, voen: " \t" },
  });
  const client = mockClient([completeButUnapproved, incompleteButApproved]);

  const eligible = await resolvePublicStoreEligibility(["unapproved", "incomplete"], client.client);

  assert.deepEqual([...eligible], []);
});

test("default requirements reject blank values for each seller type", () => {
  const individual = eligibleStore("individual", {
    vendor: { ...eligibleStore("base").vendor, sellerType: "INDIVIDUAL_ENTREPRENEUR", voen: "\ufeff\t\n" },
  });
  const company = eligibleStore("company", {
    vendor: { ...eligibleStore("base").vendor, sellerType: "REGISTERED_COMPANY", legalAddress: "\u00a0" },
  });
  assert.equal(isPublicStoreEligible(individual), false);
  assert.equal(isPublicStoreEligible(company), false);
});

test("post-query filters reject null, empty, and whitespace legal fields but preserve valid admin-managed stores", async () => {
  const invalid = [
    eligibleStore("null", { vendor: { ...eligibleStore("base").vendor, legalName: null } }),
    eligibleStore("empty", { vendor: { ...eligibleStore("base").vendor, legalName: "" } }),
    eligibleStore("whitespace", { vendor: { ...eligibleStore("base").vendor, legalName: " \t\r\n\u00a0\ufeff" } }),
  ];
  const adminManaged = eligibleStore("admin-managed", {
    adminManaged: true,
    subscription: null,
  });
  const client = mockClient([...invalid, adminManaged]);
  const filteredStores = await filterEligiblePublicStores([...invalid, adminManaged], client.client);
  const filteredProducts = await filterEligiblePublicProducts([
    { id: "p-null", storeId: "null" },
    { id: "p-empty", storeId: "empty" },
    { id: "p-whitespace", storeId: "whitespace" },
    { id: "p-admin", storeId: "admin-managed" },
  ], client.client);

  assert.deepEqual(filteredStores.map((store) => store.id), ["admin-managed"]);
  assert.deepEqual(filteredProducts.map((product) => product.id), ["p-admin"]);
});

test("public and publication entry points use trim-aware store eligibility", () => {
  for (const [path, pattern] of [
    ["app/(customer)/page.tsx", /resolvePublicStoreEligibility/],
    ["app/(customer)/categories/page.tsx", /filterEligiblePublicProducts/],
    ["app/(customer)/deals/page.tsx", /filterEligiblePublicProducts/],
    ["app/(customer)/new-products/page.tsx", /filterEligiblePublicProducts/],
    ["app/(customer)/products/page.tsx", /resolvePublicStoreEligibility/],
    ["app/(customer)/products/[productId]/page.tsx", /resolvePublicStoreEligibility/],
    ["app/(customer)/stores/[storeId]/page.tsx", /isPublicStoreEligible/],
    ["app/api/products/route.ts", /findPublicProductCatalogPage[\s\S]*exactTotal:\s*true/],
    ["app/api/products/[id]/route.ts", /resolvePublicStoreEligibility/],
    ["app/api/stores/route.ts", /filterEligiblePublicStores/],
    ["app/api/admin/homepage/featured/route.ts", /filterEligiblePublicStores[\s\S]*resolvePublicStoreEligibility/],
    ["app/api/vendor/[storeId]/products/route.ts", /resolvePublicStoreEligibility\(\[access\.storeId\], tx\)/],
    ["app/api/vendor/[storeId]/[section]/route.ts", /resolvePublicStoreEligibility\(\[storeId\],\s*tx\)/],
    ["app/api/vendor/[storeId]/campaigns/route.ts", /resolvePublicStoreEligibility\(\[storeId\], tx\)/],
    ["app/api/admin/[...resource]/route.ts", /resolvePublicStoreEligibility\(\[current\.storeId\], tx\)/],
  ] as const) {
    assert.match(source(path), pattern, path);
  }
});

test("subscription and admin-managed eligibility retain the existing policy", () => {
  const pending = eligibleStore("pending", {
    subscription: { ...eligibleStore("base").subscription!, status: "PENDING" },
  });
  const adminManaged = eligibleStore("admin-managed", {
    adminManaged: true,
    subscription: null,
  });
  assert.equal(isPublicStoreEligible(pending), false);
  assert.equal(isPublicStoreEligible(adminManaged), true);
  assert.equal(isPublicStoreEligible({ ...adminManaged, city: { isActive: false } }), false);
});

test("known store IDs are queried in bounded batches", async () => {
  const ids = Array.from({ length: 205 }, (_, index) => `store-${index}`);
  const client = mockClient(ids.map((id) => eligibleStore(id)));

  const eligible = await resolvePublicStoreEligibility(ids, client.client);

  assert.equal(eligible.size, ids.length);
  assert.deepEqual(client.calls.map((call) => call.ids.length), [100, 100, 5]);
});

test("duplicate store IDs across batch boundaries are queried only once", async () => {
  const ids = Array.from({ length: 200 }, (_, index) => `store-${index}`);
  const client = mockClient(ids.map((id) => eligibleStore(id)));

  const eligible = await resolvePublicStoreEligibility([...ids, ids[0]], client.client);

  assert.equal(eligible.size, ids.length);
  assert.deepEqual(client.calls.map((call) => call.ids.length), [100, 100]);
});

test("public product visibility requires an active product and an eligible store", () => {
  const eligible = new Set(["store-a"]);
  assert.equal(isPublicProductEligible({ id: "product-a", status: "ACTIVE", storeId: "store-a" }, eligible), true);
  assert.equal(isPublicProductEligible({ id: "product-b", status: "DRAFT", storeId: "store-a" }, eligible), false);
  assert.equal(isPublicProductEligible({ id: "product-c", status: "ACTIVE", storeId: "store-b" }, eligible), false);
});

test("cart and checkout product resolution rejects products from legally ineligible stores", async () => {
  const client = mockClient([
    eligibleStore("eligible"),
    eligibleStore("ineligible", { vendor: { ...eligibleStore("base").vendor, voen: "\u00a0" } }),
  ]);
  const eligibleProducts = await resolvePublicProductEligibility([
    { id: "product-a", status: "ACTIVE", storeId: "eligible" },
    { id: "product-b", status: "ACTIVE", storeId: "ineligible" },
    { id: "product-c", status: "DRAFT", storeId: "eligible" },
  ], client.client);
  assert.deepEqual([...eligibleProducts], ["product-a"]);
});
