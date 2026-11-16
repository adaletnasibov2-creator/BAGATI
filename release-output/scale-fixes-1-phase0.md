# Scale fixes, part 1 — Phase 0 (read-only)

Branch `feature/scale-fixes-1` from `feature/scale-audit` at 2bec212. No code changed.
V = verified (read in code or checked on the verify cluster); NV = not verified.

Environment: the verify cluster was started on 127.0.0.1:5433 only. Its `postgresql.conf` sets no port (default 5432),
so a plain `pg_ctl start` would have tried 5432. It was started with `-o "-p 5433 -c listen_addresses=127.0.0.1"`, the
same options the earlier session used. 5432 (Windows service) untouched. Schema `scale_audit`: 50,000 active products,
10 stores, **0 promotions**. V

## 1. Category counts: shared cache, TTL 30 s, keyed by city

**Today** (`lib/public-category-tree.ts:77`): React `cache()` per request only. `getPublicCategoryData()` and
`getPublicCategoryData(null)` are different keys. On `/products` and `/categories` the layout and `generateMetadata` call
it with no argument and the page with `params.city || null`, so counts run twice. V (code)

**Plan**
- New `lib/public-category-cache.ts`: a small keyed TTL cache with an injectable clock, used for this one function.
  - 30 s TTL per key. Concurrent callers share one in-flight load.
  - A generation counter: a load that started before an invalidation is not stored, so a stale result cannot outlive
    the write. The existing `createFailSafeLoader` lacks this guard, which is why it is not reused.
  - Load errors propagate and are not cached; today's behaviour is unchanged.
  - **At most 32 keys.** The city comes from the query string, so `?city=<anything>` must not grow memory without
    limit. The oldest key is evicted first.
- `getPublicCategoryData(citySlug)` normalises once: `citySlug?.trim() || null`, so undefined, null and "" share one key.
  The React `cache()` wraps the normalised call. **Callers do not change.** The layout regex in
  `scripts/production-parity.test.ts:145` keeps matching.
- **What is cached:** category rows and counts only. `catalog.showEmptyCategories` is still read per call through the
  settings cache (30 s, invalidated on save at `lib/settings/http.ts:48`). The tree (94 categories) is rebuilt per
  request, which is cheap. So a setting change needs no category invalidation. Tested anyway.
- Comment: "single PM2 process (owner, 2026-11-16; not recorded in the repo, NV). With more processes each one has its
  own cache and invalidation reaches only the process that handled the write. Others catch up within 30 s, or move the
  cache or invalidation to a shared store (Redis or Postgres LISTEN/NOTIFY)."
- **Still twice per request (by design):** `/products?city=X` runs the counts for "all cities" (layout) and for X (page).
  Two different answers, two keys. V (code)

**Invalidation: `invalidatePublicCategoryCache()` after the transaction commits** (all V from code):

| Path | File |
|---|---|
| Admin category create | `app/api/admin/category-tree/route.ts`; `app/api/admin/[...resource]/route.ts` |
| Admin category edit / activate / deactivate / delete | `app/api/admin/category-tree/[categoryId]/route.ts`; `app/api/admin/[...resource]/route.ts` |
| Admin category reorder | `app/api/admin/category-tree/[categoryId]/reorder/route.ts` |
| Admin move products between categories | `app/api/admin/category-tree/move-products/route.ts` |
| Admin product status | `app/api/admin/[...resource]/route.ts:221` |
| Admin product edit (category) | `app/api/admin/products/[productId]/route.ts:70` |
| Admin store import (create / update) | `app/api/admin/stores/[storeId]/imports/route.ts:116,168` |
| Admin store activation (publishes drafts) | `app/api/admin/stores/[storeId]/activation/route.ts` |
| Seller product create (can be ACTIVE) | `app/api/vendor/[storeId]/products/route.ts` POST |
| Seller product edit / status / category | `app/api/vendor/[storeId]/products/[productId]/route.ts` |
| Seller CSV import (updates categoryId of existing) | `app/api/vendor/[storeId]/[section]/route.ts:273` |
| Seller import job (creates DRAFTs) | `app/api/vendor/[storeId]/imports/jobs/[jobId]/process/route.ts` |

**Not invalidated; corrected within 30 s by the TTL:** store status or archive, subscription and complimentary
entitlement changes, city activation, user deactivation, and subscription or entitlement periods that end with no write
at all. NV (each one exists; I did not list every write site)

## 2. Homepage: one query for campaign products

**Today** (`app/(customer)/page.tsx:152`): up to 8 queries, one per promotional campaign. Each has `take: 10`, its own
`storeId`, and ordering by product name, then id. V

**Catch:** a single `findMany` on `promotionId IN (…)` cannot apply "10 per campaign" in the database.
- Option **(i), recommended:** one `findMany` with `OR: [{ promotionId, product.storeId }]` per campaign, the same
  product filter, ordered by product name then id, **no take**. Group by promotionId in memory and keep the first 10 of
  each.
  - The output is identical: each campaign's list is an ordered subset of the global order.
  - Fetch size is bounded at 8 × 100 rows, because both write paths cap a promotion at 100 products: vendor
    `campaigns/route.ts:18`, admin `lib/admin-product-management.ts:54`. V
  - Older rows written before the caps would not be bounded. NV
- Option (ii): raw SQL `ROW_NUMBER() OVER (PARTITION BY promotionId)` for the ids, then one Prisma query for details.
  Exact and bounded, but it repeats the stock and eligibility filter in SQL. Higher risk of drifting from the Prisma
  version.
- The grouping goes into a pure function in `lib/homepage-campaign-products.ts`, with a unit test.
- An integration test on 5433 seeds promotions in a rolled-back transaction and asserts the old per-campaign result
  equals the new grouped result.
- **No load effect can be measured on the current fixtures:** `scale_audit` has 0 promotions. V

## 3. Favorites batch endpoint

**Today:** `components/favorites-client.tsx:9` sends one `GET /api/products/[id]` per saved id. V
`GET /api/products` already exists: it is the catalog list (`app/api/products/route.ts`). V

**Plan**
- `GET /api/products?ids=a,b,c` becomes its own branch, taken only when `ids` is present. The catalog branch is unchanged.
- Rules:
  - Ids are deduplicated; each must be 1–64 characters of `[A-Za-z0-9_-]`; at most 50 ids, otherwise 400.
  - Returns `{ items }` in request order, using the same `where` (`publicProductVisibilityWhere()`), the same
    `include` and the same `resolvePublicStoreEligibility` check as `/api/products/[id]`.
  - Ineligible or unknown ids are left out silently, the same as a 404 today.
- Logic in a new `lib/public-product-batch.ts` with an injectable client, for the unit tests (cap, invalid id, order,
  eligibility filter).
- The single endpoint stays.
- **Client:** one request per 50 ids, so a customer with more than 50 favorites still sees all of them.
  Recommended over truncating.

## 4. Legacy vendor `[section]` route

Next.js matches a static folder before `[section]`. V (folders); NV (not exercised at runtime)
- **`products` section: unreachable.** `app/api/vendor/[storeId]/products/route.ts` exists and exports GET and POST, so
  GET and POST on `/products` never reach `[section]` (lines 65, 160–176). It has no PATCH, so PATCH on `/products`
  answers 405 and `[section]` lines 374–455 are unreachable too. The screen (`components/vendor-section.tsx:26`) calls
  `/products`, which is the paginated route (24 per page). **No caller of the unbounded branch.**
- **`inventory` section: one caller,** `components/vendor-inventory-panel.tsx:30`. It loads every inventory row of the
  store (`[section]/route.ts:66`, no `take`). In the browser it then computes the ok/low/out counts over all rows,
  filters by level, searches name and SKU, and sorts out-of-stock first. Server paging alone (take 50) would make the
  counts, search and sort cover only the first 50 rows. **That would break the screen.**
- Doing it right means moving search, the level filter, the level counts and the sort to the server, plus a pager in
  the panel.
  - The level rule `max(0, quantity − reserved) ≤ lowStockThreshold` compares columns arithmetically. Prisma's `where`
    cannot express that, so it needs raw SQL.
  - That is a larger change to a seller screen than "add take/skip".
- Options: (a) do it in this part; (b) **move it to part 2 (recommended)** and in part 1 only delete the unreachable
  `products` branches of `[section]`; (c) leave everything as is.

## 5. Prisma pool: documentation only

New `docs/database-connection-pool.md`. No other doc covers it today (`connection_limit` and `pool_timeout` appear
nowhere in the repo). V
- How to set them: `DATABASE_URL=...?connection_limit=N&pool_timeout=S`. The default pool is
  `num_physical_cpus × 2 + 1` (5 on 2 vCPU); `pool_timeout` defaults to 10 s.
- Error codes, and how the audit's failures were P2024.
- What to measure on Cloudways first:
  - vCPU count (`nproc`) and RAM headroom;
  - whether Postgres is local or managed;
  - `SHOW max_connections`, and connections already in use;
  - PM2 process count (pool × processes ≤ max_connections minus reserve);
  - a short 1/5/10/25 load run against staging only.

## Files to change

| Item | Files |
|---|---|
| 1 | new `lib/public-category-cache.ts`; `lib/public-category-tree.ts`; the 12 route files in the table above; new `scripts/public-category-cache.test.ts` (added to `test:category-tree`) |
| 2 | `app/(customer)/page.tsx`; `lib/homepage-campaign-products.ts`; `scripts/homepage-campaign-products.test.ts`; new `scripts/homepage-campaign-query.integration.test.ts` |
| 3 | `app/api/products/route.ts`; new `lib/public-product-batch.ts`; `components/favorites-client.tsx`; new `scripts/public-product-batch.test.ts`; new `scripts/public-product-batch.integration.test.ts` |
| 4 | (b): `app/api/vendor/[storeId]/[section]/route.ts` (delete the unreachable `products` GET / POST / PATCH branches) |
| 5 | new `docs/database-connection-pool.md` |
| Report | `release-output/scale-fixes-1-report.md` |

Static tests read several of these files (for example `production-parity`, `admin-homepage`, `show-empty-categories`,
`public-store-eligibility`, `vendor-seller-authorization.test.mjs`). They are re-run, and any assertion that breaks is
reported, not loosened silently.

## Measurement plan

- **"Before" numbers:** rerun 1/5/10/25 at 50k on a build of 2bec212 in this session, then build the branch and rerun
  "after". Same machine state, same day. Recommended over reusing the 2026-11-16 numbers.
- Isolated build dirs (`.next-scale-before`, `.next-scale-after`). `tsconfig.json` and `next-env.d.ts` are restored
  after each build.
- `DATABASE_URL` points at the verify URL with `schema=scale_audit`. Schema `scale_audit` is kept.
- The homepage campaign fix will not show in these numbers (0 promotions). Optional: add 8 promotions × 50 products to
  `scale_audit` before both runs.

## Decisions needed

1. Item 2: option (i), one query and slice in memory (recommended), or (ii), raw SQL `ROW_NUMBER`?
2. Item 4: (a) server-side paging of the inventory panel now, (b) part 2 plus delete the unreachable `products`
   branches (recommended), or (c) leave it?
3. Item 1: cache rows and counts only, and read the setting through the settings cache (recommended)?
4. Item 3: reject more than 50 ids with 400, and the client sends batches of 50 (recommended)?
5. Measurement: rebuild and rerun "before" this session (recommended)? Seed 8 promotions for the homepage?
