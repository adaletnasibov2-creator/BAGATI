import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  VendorProductPatchError,
  hasVendorProductStoreAccess,
  vendorProductPatchSchema,
  runVendorProductPatch,
  type VendorProductPatchDatabase,
} from "../lib/vendor-product-patch";

const priorLegalPolicy = process.env.BAGATI_SELLER_LEGAL_POLICY;
before(() => {
  process.env.BAGATI_SELLER_LEGAL_POLICY = JSON.stringify({
    INDIVIDUAL_ENTREPRENEUR: ["legalName", "voen"],
    REGISTERED_COMPANY: ["legalName", "voen", "legalAddress"],
  });
});
after(() => {
  if (priorLegalPolicy === undefined) delete process.env.BAGATI_SELLER_LEGAL_POLICY;
  else process.env.BAGATI_SELLER_LEGAL_POLICY = priorLegalPolicy;
});

const store = (overrides: Record<string, unknown> = {}) => ({
  id: "store-a",
  status: "ACTIVE",
  isActive: true,
  legalInfoApproved: true,
  adminManaged: false,
  city: { isActive: true },
  vendor: {
    sellerType: "INDIVIDUAL_ENTREPRENEUR",
    legalName: "Synthetic Seller",
    voen: "1234567890",
    legalAddress: null,
    user: { isActive: true },
  },
  subscription: {
    status: "ACTIVE",
    currentPeriodStart: null,
    currentPeriodEnd: null,
    plan: { slug: "basic", isActive: true },
  },
  ...overrides,
});

const product = (id = "product-a", storeId = "store-a", status = "DRAFT", overrides: Record<string, unknown> = {}) => ({
  id,
  storeId,
  status,
  name: "Synthetic Product",
  description: null,
  sku: null,
  price: 25,
  discountPrice: null,
  categoryId: "category-a",
  category: { isActive: true },
  brandId: null,
  images: [],
  variants: [],
  inventory: [{ id: `inventory-${id}`, productId: id, variantId: null, quantity: 5, reserved: 0, lowStockThreshold: 5 }],
  ...overrides,
});

const patchValues = (overrides: Record<string, unknown> = {}) => vendorProductPatchSchema.parse({
  name: "Synthetic Product",
  description: null,
  sku: null,
  price: 25,
  discountPrice: null,
  categoryId: "category-a",
  brandId: null,
  images: [],
  status: "ACTIVE",
  ...overrides,
});

function fakeDatabase(options: {
  stores?: Record<string, ReturnType<typeof store>>;
  products?: ReturnType<typeof product>[];
  onProductUpdate?: (item: ReturnType<typeof product>) => void;
} = {}) {
  const stores = options.stores ?? { "store-a": store() };
  const products = options.products ?? [product()];
  const queryLog: string[] = [];
  let transactionTail: Promise<void> = Promise.resolve();
  const transactionOptions: unknown[] = [];
  const tx = {
    // Accepts both tagged-template calls and Prisma.sql objects (used by the product-code duplicate check).
    $queryRaw: async (parts: TemplateStringsArray | { strings: readonly string[] }) => {
      queryLog.push((Array.isArray(parts) ? parts : (parts as { strings: readonly string[] }).strings).join("?"));
      return [];
    },
    store: {
      findUnique: async ({ where }: { where: { id: string } }) => stores[where.id] ?? null,
    },
    product: {
      findFirst: async ({ where }: { where: { id: string; storeId: string } }) =>
        products.find((row) => row.id === where.id && row.storeId === where.storeId) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) => products.find((row) => row.id === where.id) ?? null,
      count: async ({ where }: { where: { storeId: string; status: string } }) =>
        products.filter((row) => row.storeId === where.storeId && row.status === where.status).length,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const item = products.find((row) => row.id === where.id);
        assert.ok(item);
        Object.assign(item, data, {
          categoryId: (data.category as { connect?: { id: string } } | undefined)?.connect?.id ?? item.categoryId,
        });
        options.onProductUpdate?.(item);
        return item;
      },
    },
    category: {
      findFirst: async () => ({ isActive: true }),
    },
    productVariant: {
      updateMany: async () => ({ count: 0 }),
    },
    inventory: {
      findFirst: async ({ where }: { where: { productId: string; variantId: null } }) => {
        const item = products.find((row) => row.id === where.productId);
        return item?.inventory.find((row) => row.variantId === where.variantId) ?? null;
      },
      update: async ({ where, data }: { where: { id: string }; data: { quantity: number; lowStockThreshold: number } }) => {
        for (const item of products) {
          const row = item.inventory.find((entry) => entry.id === where.id);
          if (!row) continue;
          Object.assign(row, data);
          return row;
        }
        throw new Error(`inventory ${where.id} was not found`);
      },
      create: async ({ data }: { data: { productId: string; quantity: number; lowStockThreshold: number } }) => {
        const item = products.find((row) => row.id === data.productId);
        assert.ok(item);
        const row = { id: `inventory-created-${data.productId}`, variantId: null, reserved: 0, ...data };
        item.inventory.push(row);
        return row;
      },
    },
    inventoryAdjustment: {
      create: async () => ({ id: "adjustment" }),
    },
  };
  return {
    queryLog,
    transactionOptions,
    database: {
      $transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>, transactionOption: unknown) => {
        let release!: () => void;
        const previous = transactionTail;
        transactionTail = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        transactionOptions.push(transactionOption);
        try {
          return await callback(tx);
        } finally {
          release();
        }
      },
    } as unknown as VendorProductPatchDatabase,
    tx,
  };
}

test("the actual vendor PATCH operation activates an eligible, ready product", async () => {
  const fake = fakeDatabase();
  const saved = await runVendorProductPatch(fake.database, {
    storeId: "store-a",
    productId: "product-a",
    values: patchValues(),
    isOwnedImage: () => true,
    actorUserId: "vendor-a",
    now: new Date("2026-10-23T00:00:00.000Z"),
  });
  assert.equal(saved.status, "ACTIVE");
  assert.deepEqual(fake.transactionOptions, [{ isolationLevel: "Serializable" }]);
  assert.ok(fake.queryLog.findIndex((sql) => sql.includes('FROM "Store"')) < fake.queryLog.findIndex((sql) => sql.includes('FROM "Product"')));
});

test("vendor API access rejects missing sessions and non-vendor roles", () => {
  assert.equal(hasVendorProductStoreAccess(null), false);
  assert.equal(hasVendorProductStoreAccess({ storeId: "store-a", user: { id: "customer-a", role: "CUSTOMER" } }), false);
  assert.equal(hasVendorProductStoreAccess({ storeId: "store-a", user: { id: "vendor-a", role: "VENDOR" } }), true);
});

test("the actual vendor PATCH operation rejects legal, approval, and subscription blockers", async () => {
  const cases = [
    { store: store({ vendor: { ...store().vendor, legalName: " " } }), reason: "STORE_NOT_ELIGIBLE" },
    { store: store({ legalInfoApproved: false }), reason: "STORE_NOT_ELIGIBLE" },
    { store: store({ subscription: { ...store().subscription, status: "PENDING" } }), reason: "STORE_NOT_ELIGIBLE" },
    { store: store({ subscription: { ...store().subscription, status: "ACTIVE", plan: { slug: "unsupported", isActive: true } } }), reason: "STORE_NOT_ELIGIBLE" },
    { store: store({ subscription: { ...store().subscription, status: "ACTIVE", plan: { slug: "basic", isActive: false } } }), reason: "STORE_NOT_ELIGIBLE" },
    { store: store({ isActive: false }), reason: "STORE_NOT_ELIGIBLE" },
  ];
  for (const scenario of cases) {
    const fake = fakeDatabase({ stores: { "store-a": scenario.store } });
    await assert.rejects(runVendorProductPatch(fake.database, {
      storeId: "store-a",
      productId: "product-a",
      values: patchValues(),
      isOwnedImage: () => true,
      actorUserId: "vendor-a",
    }), (error: unknown) => error instanceof VendorProductPatchError && error.code === scenario.reason);
  }
});

test("required legal fields containing NULL, empty, or whitespace-only values reject activation", async () => {
  for (const legalPatch of [
    { legalName: null },
    { legalName: "" },
    { legalName: " \t\n" },
    { voen: null },
    { voen: "" },
    { voen: "\t " },
  ]) {
    const incomplete = store({
      vendor: { ...store().vendor, ...legalPatch },
    });
    const fake = fakeDatabase({ stores: { "store-a": incomplete } });
    await assert.rejects(runVendorProductPatch(fake.database, {
      storeId: "store-a",
      productId: "product-a",
      values: patchValues(),
      isOwnedImage: () => true,
      actorUserId: "vendor-a",
    }), (error: unknown) => error instanceof VendorProductPatchError && error.code === "STORE_NOT_ELIGIBLE");
  }

  const complete = fakeDatabase();
  const saved = await runVendorProductPatch(complete.database, {
    storeId: "store-a",
    productId: "product-a",
    values: patchValues(),
    isOwnedImage: () => true,
    actorUserId: "vendor-a",
  });
  assert.equal(saved.status, "ACTIVE");
});

test("admin-managed store exception still requires legal approval and product readiness", async () => {
  const managedStore = store({
    adminManaged: true,
    subscription: null,
  });
  const success = fakeDatabase({ stores: { "store-a": managedStore } });
  assert.equal((await runVendorProductPatch(success.database, {
    storeId: "store-a",
    productId: "product-a",
    values: patchValues(),
    isOwnedImage: () => true,
    actorUserId: "vendor-a",
  })).status, "ACTIVE");

  const unapproved = fakeDatabase({ stores: { "store-a": { ...managedStore, legalInfoApproved: false } } });
  await assert.rejects(runVendorProductPatch(unapproved.database, {
    storeId: "store-a",
    productId: "product-a",
    values: patchValues(),
    isOwnedImage: () => true,
    actorUserId: "vendor-a",
  }), (error: unknown) => error instanceof VendorProductPatchError && error.code === "STORE_NOT_ELIGIBLE");
});

test("the actual vendor PATCH operation enforces the active-product plan limit", async () => {
  const products = Array.from({ length: 301 }, (_, index) => product(`active-${index}`, "store-a", "ACTIVE"));
  products[300] = product("product-a", "store-a", "DRAFT");
  const fake = fakeDatabase({ products });
  await assert.rejects(runVendorProductPatch(fake.database, {
    storeId: "store-a",
    productId: "product-a",
    values: patchValues(),
    isOwnedImage: () => true,
    actorUserId: "vendor-a",
  }), (error: unknown) => error instanceof VendorProductPatchError
    && error.code === "PRODUCT_LIMIT_REACHED"
    && (error.details as { current?: number }).current === 300);
});

test("product IDs are looked up with the requested store ID", async () => {
  const fake = fakeDatabase({ products: [product("owned-by-store-b", "store-b")] });
  await assert.rejects(runVendorProductPatch(fake.database, {
    storeId: "store-a",
    productId: "owned-by-store-b",
    values: patchValues(),
    isOwnedImage: () => true,
    actorUserId: "vendor-a",
  }), (error: unknown) => error instanceof VendorProductPatchError && error.code === "NOT_FOUND");
});

test("draft edits remain available when activation prerequisites are not met", async () => {
  const inactive = store({
    status: "SUSPENDED",
    isActive: false,
    legalInfoApproved: false,
    subscription: { ...store().subscription, status: "PENDING" },
  });
  const fake = fakeDatabase({ stores: { "store-a": inactive } });
  const saved = await runVendorProductPatch(fake.database, {
    storeId: "store-a",
    productId: "product-a",
    values: patchValues({ status: "DRAFT", name: "Updated draft" }),
    isOwnedImage: () => true,
    actorUserId: "vendor-a",
  });
  assert.equal(saved.name, "Updated draft");
  assert.equal(saved.status, "DRAFT");
});

test("editing an already-active product does not repeat transition-only publication checks", async () => {
  const inactiveStore = store({
    status: "SUSPENDED",
    isActive: false,
    legalInfoApproved: false,
    subscription: { ...store().subscription, status: "PENDING" },
  });
  const fake = fakeDatabase({
    stores: { "store-a": inactiveStore },
    products: [product("product-a", "store-a", "ACTIVE")],
  });
  const saved = await runVendorProductPatch(fake.database, {
    storeId: "store-a",
    productId: "product-a",
    values: patchValues({ status: "ACTIVE", name: "Edited active product" }),
    isOwnedImage: () => true,
    actorUserId: "vendor-a",
  });
  assert.equal(saved.status, "ACTIVE");
  assert.equal(saved.name, "Edited active product");
});

test("product publication data blockers reject activation in the actual PATCH operation", async () => {
  const cases = [
    { values: patchValues({ categoryId: null }), existingProduct: product() },
    { values: patchValues({ price: 10_000_000_000 }), existingProduct: product() },
    { values: patchValues(), existingProduct: product("product-a", "store-a", "DRAFT", { inventory: [] }) },
    { values: patchValues(), existingProduct: product("product-a", "store-a", "DRAFT", { inventory: [{ variantId: null, quantity: 1, reserved: 2 }] }) },
    {
      values: patchValues({
        variants: [{ name: "Size", sku: null, options: {}, isActive: true, price: null, discountPrice: null, images: [], quantity: 1, lowStockThreshold: 0 }],
      }),
      existingProduct: product(),
    },
  ];
  for (const scenario of cases) {
    const fake = fakeDatabase({ products: [scenario.existingProduct] });
    await assert.rejects(runVendorProductPatch(fake.database, {
      storeId: "store-a",
      productId: "product-a",
      values: scenario.values,
      isOwnedImage: () => true,
      actorUserId: "vendor-a",
    }), (error: unknown) => error instanceof VendorProductPatchError && error.code === "PRODUCT_NOT_READY");
  }
});

test("invalid activation payloads fail schema validation before database access", () => {
  const invalid = vendorProductPatchSchema.safeParse({
    ...patchValues(),
    status: "PENDING_REVIEW",
  });
  assert.equal(invalid.success, false);
});

test("concurrent activations serialize and cannot exceed the active-product limit", async () => {
  const products = Array.from({ length: 301 }, (_, index) => product(`active-${index}`, "store-a", "ACTIVE"));
  products[299] = product("draft-a", "store-a", "DRAFT");
  products[300] = product("draft-b", "store-a", "DRAFT");
  const fake = fakeDatabase({ products });
  const activate = (productId: string) => runVendorProductPatch(fake.database, {
    storeId: "store-a",
    productId,
    values: patchValues(),
    isOwnedImage: () => true,
    actorUserId: "vendor-a",
  });
  const results = await Promise.allSettled([activate("draft-a"), activate("draft-b")]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  assert.ok(rejected?.reason instanceof VendorProductPatchError);
  assert.equal(rejected.reason.code, "PRODUCT_LIMIT_REACHED");
  assert.equal(products.filter((row) => row.status === "ACTIVE").length, 300);
});

test("stock values stay distinct for omitted, empty, invalid, explicit, and zero input", () => {
  const base = {
    name: "Synthetic Product",
    description: null,
    sku: null,
    price: 25,
    discountPrice: null,
    categoryId: "category-a",
    brandId: null,
    images: [],
    status: "DRAFT" as const,
    variantsEnabled: false,
  };
  assert.equal(vendorProductPatchSchema.parse(base).quantity, undefined);
  assert.equal(vendorProductPatchSchema.parse({ ...base, quantity: 0, lowStockThreshold: 0 }).quantity, 0);
  assert.equal(vendorProductPatchSchema.parse({ ...base, quantity: "12", lowStockThreshold: "4" }).quantity, 12);
  assert.equal(vendorProductPatchSchema.safeParse({ ...base, quantity: "" }).success, false);
  assert.equal(vendorProductPatchSchema.safeParse({ ...base, quantity: null }).success, false);
  assert.equal(vendorProductPatchSchema.safeParse({ ...base, quantity: "1.5" }).success, false);
  assert.equal(vendorProductPatchSchema.safeParse({ ...base, quantity: "abc" }).success, false);
  assert.equal(vendorProductPatchSchema.safeParse({
    ...base,
    variants: [{ name: "Size", sku: null, options: { size: "M" }, isActive: true, price: null, discountPrice: null, images: [], quantity: "", lowStockThreshold: 1 }],
  }).success, false);
  assert.equal(vendorProductPatchSchema.parse({
    ...base,
    variantsEnabled: true,
    variants: [{ name: "Size", sku: null, options: { size: "M" }, isActive: true, price: null, discountPrice: null, images: [], quantity: 0, lowStockThreshold: 1 }],
  }).variants?.[0].quantity, 0);
});

test("editing the name or price does not replace existing stock with zero", async () => {
  for (const overrides of [{ name: "Renamed product" }, { price: 40 }]) {
    const existing = product();
    const fake = fakeDatabase({ products: [existing] });
    await runVendorProductPatch(fake.database, {
      storeId: "store-a",
      productId: "product-a",
      values: patchValues({ status: "DRAFT", variantsEnabled: false, ...overrides }),
      isOwnedImage: () => true,
      actorUserId: "vendor-a",
    });
    assert.equal(existing.inventory[0].quantity, 5);
    if ("name" in overrides) assert.equal(existing.name, overrides.name);
    if ("price" in overrides) assert.equal(Number(existing.price), overrides.price);
  }
});

test("an explicit stock update and an intentional zero are persisted", async () => {
  const existing = product();
  const fake = fakeDatabase({ products: [existing] });
  await runVendorProductPatch(fake.database, {
    storeId: "store-a",
    productId: "product-a",
    values: patchValues({ status: "DRAFT", variantsEnabled: false, quantity: 18 }),
    isOwnedImage: () => true,
    actorUserId: "vendor-a",
  });
  assert.equal(existing.inventory[0].quantity, 18);
  await runVendorProductPatch(fake.database, {
    storeId: "store-a",
    productId: "product-a",
    values: patchValues({ status: "DRAFT", variantsEnabled: false, quantity: 0 }),
    isOwnedImage: () => true,
    actorUserId: "vendor-a",
  });
  assert.equal(existing.inventory[0].quantity, 0);
});

test("serialized stock updates keep the last explicit quantity", async () => {
  const existing = product();
  const fake = fakeDatabase({ products: [existing] });
  const update = (quantity: number) => runVendorProductPatch(fake.database, {
    storeId: "store-a",
    productId: "product-a",
    values: patchValues({ status: "DRAFT", variantsEnabled: false, quantity }),
    isOwnedImage: () => true,
    actorUserId: "vendor-a",
  });
  await Promise.all([update(4), update(7)]);
  assert.ok(existing.inventory[0].quantity === 4 || existing.inventory[0].quantity === 7);
  await runVendorProductPatch(fake.database, {
    storeId: "store-a",
    productId: "product-a",
    values: patchValues({ status: "DRAFT", variantsEnabled: false }),
    isOwnedImage: () => true,
    actorUserId: "vendor-a",
  });
  assert.ok(existing.inventory[0].quantity === 4 || existing.inventory[0].quantity === 7);
});
