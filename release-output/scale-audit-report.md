# Scale audit: catalog at 3k / 10k / 50k products

Date: 2026-11-16. Branch `feature/scale-audit`. Tooling: `scripts/scale-audit/` (commit e2d78b3).

Every statement is marked **V** (verified: measured, or read in the code) or **NV** (not verified).

## Read this first

- **All numbers come from one local Windows machine with 12 logical cores** (Prisma reported a default pool of
  17 connections, i.e. 8 physical cores × 2 + 1). App and Postgres ran on the same machine. **V**
- **They do not describe Cloudways Velocity.** Velocity has 3.82 GB RAM and an unknown number of vCPUs. Production has to
  be measured on its own. Treat the numbers below as *where things break and why*, not as capacity figures. **NV for
  production**
- Setup: `next start` (production build, `.next-scale`) on port 3110 against scratch schema `scale_audit` on the
  verify cluster 127.0.0.1:5433. 10 eligible stores, 20,000 customers, 5,000 orders, 3k/10k/50k ACTIVE products over
  the 15/79 category tree. Port 5432 was never used. **V**
- Not done in this session (see "Open items"): the smaller-pool test, the in-process cache test, and dropping the
  scratch schema. The 5433 cluster was stopped when this session began. The standing rule is not to start it without
  approval. **V**

## 1. Sequential timings by size (1 cold + 30 warm requests, one at a time) — V

Median / p95 in ms. Response sizes are for the 50k run.

| Endpoint | 3k median / p95 | 10k median / p95 | 50k median / p95 | Bytes (50k) |
|---|---|---|---|---|
| `/` home | 335 / 452 | 189 / 610 | 196 / 262 | 518 KB |
| `/products` | 318 / 385 | 120 / 311 | 142 / 162 | **950 KB** |
| `/products?category=…` (top level) | 330 / 407 | 387 / 478 | 161 / 192 | 937 KB |
| `/products?q=Smartfon` | 311 / 337 | 394 / 481 | 150 / 174 | 949 KB |
| `/products?q=<rare>` | 199 / 223 | 258 / 345 | 120 / 135 | 524 KB |
| `/categories?category=…` | 343 / 382 | 753 / 924 | 336 / 374 | 529 KB |
| `/stores/[id]` | 106 / 206 | 189 / 237 | 99 / 119 | 464 KB |
| `/products/[id]` | 53 / 68 | 129 / 164 | 83 / 97 | 174 KB |
| cart API | 30 / 52 | 47 / 75 | 22 / 83 | — |
| order create (POST) | 126 / 160 | 138 / 173 | 42 / 58 | — |
| admin product list | 141 / 224 | 127 / 186 | 67 / 87 | 279 KB |

No errors at any size. Server memory stayed between 246 and 578 MB. **V**

**Caveat:** single-request times do not rise steadily with catalog size: 50k is faster than 3k on most rows. The order of
the runs (3k first, on a cold machine) and other load on the desktop add more noise than the data does. At this
concurrency, rendering cost dominates and the database share is small. For the database cost of size, use the EXPLAIN
numbers in section 3, which isolate the database. **V (the noise); NV (the cause)**

## 2. Concurrency at 50k products — V

Closed loop: N virtual visitors, each sends its next request as soon as the last one answers. 20 s per level,
ascending, with a drain/settle step between runs. Default Prisma pool (17 connections, pool timeout 10 s).

Throughput (requests/s) and p50 / p95 latency (ms):

| Visitors | Home rps · p50/p95 | Category rps · p50/p95 | Product page rps · p50/p95 | Search rps · p50/p95 |
|---|---|---|---|---|
| 1 | 5.1 · 190/232 | 6.4 · 154/195 | 11.9 · 81/108 | 6.7 · 145/175 |
| 5 | 12.9 · 376/441 | 12.7 · 390/437 | 38.4 · 124/173 | 13.0 · 380/428 |
| 10 | 13.6 · 718/849 | 12.6 · 782/886 | 29.8 · 289/610 | 11.1 · 876/1031 |
| 25 | 11.7 · 2151/2294 | 4.1 · 7034/8078 | 10.7 · 2313/3142 | 3.2 · 7653/10847 |
| 100 | 4.2 · 23530/23599 | 5.2 · 17125/17960 | 11.2 · 9385/10993 | 6.3 · 14104/28379 |
| 300 | 13.6 · — | 9.9 · — | 13.2 · 26325/26502 | 11.5 · 24861/25966 |

Error rate (5xx + timeouts):

| Visitors | Home | Category | Product page | Search |
|---|---|---|---|---|
| 1–10 | 0 % | 0 % | 0 % | 0 % |
| 25 | 0 % | 1 % | 0 % | **9.6 %** |
| 100 | **29 %** | **88 %** | 0 % | **80 %** |
| 300 | **100 %** | **100 %** (all timeouts) | **82 %** | **94 %** |

What this shows:

- **The listing pages top out at about 13 requests/s and reach that with 5 visitors.** Beyond 5, extra visitors only
  queue: latency grows in proportion and throughput stays flat. **V**
- **Failures start at 25 visitors on category and search pages.** All the 5xx in the server log are pool exhaustion: 916 ×
  `P2024 Timed out fetching a new connection from the connection pool (connection limit: 17)` and 879 ×
  `Unable to start a transaction in the given time`. The database itself did not fail. Requests waited more than 10 s
  for a connection. **V**
- Database connections peaked at 17 (the pool size) from 10 visitors upward. Server memory peaked at 924 MB. **V**
- The product detail page holds up best (38 rps at 5 visitors; 0 % errors up to 100 visitors), because it runs no
  catalog-wide queries. **V**
- "Visitors" here means requests in flight at the same moment. Real visitors pause between clicks, so 13 rps serves
  many more than 13 people browsing. The conversion depends on traffic shape and was not measured. **NV**

## 3. EXPLAIN (ANALYZE, BUFFERS) of the app's own SQL — V

Captured from the exact statements that `lib/public-product-catalog.ts` and `lib/public-category-tree.ts` send.
Heaviest-query time in ms:

| Query | 3k | 10k | 50k | Plan at 50k |
|---|---|---|---|---|
| Category counts (`groupBy`, every page) | 10 | 16 | 51 | reads **all 50,000** active products of eligible stores, HashAggregate → 793 groups; 21,597 buffers |
| `/products` newest | 5 | 9 | 44–54 | reads all 50,000, top-N heapsort for 100 rows |
| `/products?category=<top>` | 11 | 15 | 58–69 | reads all 50,000, filter drops 45,188, then sorts 4,812 |
| `/products?q=Smartfon` | 6 | 12 | 53–55 | reads all 50,000, `ILIKE '%…%'` filter drops 4,792 per store |
| `/products?q=<rare>` | 5 | 11 | 52 | same full read; finds nothing |
| `/products?sort=name` | 5 | 10 | 42 | reads all 50,000, sorts by name |

Findings from the plans:

- The plan always starts from the ~10 eligible stores and pulls **every** ACTIVE product for each one
  (`Product_storeId_status_idx`, 5,000 rows × 10 loops). It then sorts and keeps 100. Cost grows linearly with the
  catalog: about 1 ms per 1,000 products, so roughly 100 ms at 100k. **V (to 50k); NV (beyond)**
- No index matches the ORDER BY. `Product` has only `(categoryId, status)` and `(storeId, status)` indexes
  (`prisma/schema.prisma:603-604`). It has none on `createdAt` or `name`. **V**
- Search uses `contains … mode: "insensitive"` → `ILIKE '%term%'` (`lib/public-product-catalog.ts:121-125`), which no
  B-tree index can serve. **V**
- Everything ran from shared buffers (no disk reads). On a server where the table no longer fits in cache, these
  numbers get worse. **NV**

## 4. Findings

| # | Finding | Where | Status |
|---|---|---|---|
| F1 | Every listing reads all active products of all eligible stores, then sorts and keeps 100. Cost grows linearly with the catalog. | `lib/public-product-catalog.ts`; plans in §3 | V |
| F2 | Category counts (`groupBy` over all active products, ~51 ms at 50k; 7 queries, 131 ms for the whole function) run on every page through the layout. | `lib/public-category-tree.ts:46`, `app/(customer)/layout.tsx:24` | V |
| F3 | On `/products` and `/categories` the counts run **twice** per request. React `cache()` keys on the argument: the layout and `generateMetadata` call `getPublicCategoryData()` (undefined), and the page calls `getPublicCategoryData(params.city \|\| null)` (null). Those are two different cache keys. | `app/(customer)/products/page.tsx:30,53`, `app/(customer)/categories/page.tsx:23,36` | V (code); the double execution itself was not traced in this session |
| F4 | The homepage runs one `promotionProduct.findMany` per promotional campaign (N+1). | `app/(customer)/page.tsx:152` | V (code); cost not measured |
| F5 | The 50k `/products` page sends 950 KB of HTML. The earlier session counted 343 inline SVGs on it, mostly icons repeated on each card. | §1; SVG count from the earlier session | V (size); SVG count not re-checked |
| F6 | No `Product` index on `createdAt` or `name`, the two catalog sort keys. | `prisma/schema.prisma:603-604` | V |
| F7 | Search uses `ILIKE '%…%'` on name, description and SKU. No index can serve it. | `lib/public-product-catalog.ts:121-125` | V |
| F8 | The favorites page sends one `GET /api/products/[id]` per saved product. | `components/favorites-client.tsx:9` | V (code) |
| F9 | The legacy vendor endpoint `GET /api/vendor/[storeId]/products` (the `[section]` route) returns **all** of a store's products, with category, brand, variants and inventory, without `take`. The `inventory` section is also unbounded. The newer `app/api/vendor/[storeId]/products/route.ts` is paginated (24 per page). | `app/api/vendor/[storeId]/[section]/route.ts:65-66` | V (code); whether any screen still calls it was not checked |
| F10 | Under load, failures come from Prisma pool starvation (P2024, 10 s timeout), not from database errors. The pool fills because each listing request holds connections for several ~50 ms full-scan queries. | server log, §2 | V |
| F11 | The default pool is `num_physical_cpus × 2 + 1`. On a 2-vCPU server that is 5 connections, a third of what was tested here. Errors would start at fewer visitors. | Prisma docs; not measured | NV |

## 5. Ranked fix list

Gain and risk are estimates. Only the problems are verified, not the fixes; no fix was implemented or measured.

| Rank | Fix | Addresses | Expected gain | Risk | Status |
|---|---|---|---|---|---|
| 1 | Cache category counts across requests (short TTL, e.g. 30–60 s, keyed by city), and call `getPublicCategoryData` with the same argument everywhere. | F2, F3 | Removes 1–2 full scans (~50 ms each at 50k, 131 ms per function call) from **every** page; frees pool connections. The largest win per line of code. | Low–medium: counts and the "show empty categories" switch lag by up to the TTL. Needs invalidation or an accepted delay. Per-process cache only (one cache per Node process). | NV (cache test not run) |
| 2 | Rewrite the listing query: resolve the eligible store IDs first (a small set), then `WHERE storeId IN (…) AND status='ACTIVE' ORDER BY createdAt DESC, id DESC LIMIT n`, with an index on `Product(status, createdAt DESC, id DESC)` (plus `(status, name, id)` for name sort). | F1, F6 | Listing query becomes index-ordered: expected from ~50 ms to a few ms at 50k, flat as the catalog grows. | Medium: eligibility rules (subscription, complimentary entitlement, city, user active) must stay identical. Covered by `test:public-product-catalog` and the pagination integration tests. Adding an index in production needs `CREATE INDEX CONCURRENTLY` outside the Prisma migration transaction. | NV |
| 3 | Set the pool explicitly in production (`connection_limit`, `pool_timeout`) after measuring Velocity's vCPUs and Postgres `max_connections`. Do not rely on the CPU-based default. | F10, F11 | Prevents a 5-connection pool on 2 vCPU; makes overload fail fast instead of after 10 s. Does not add throughput by itself. | Low. Too large a pool can overload a small Postgres. | NV |
| 4 | Cut the listing HTML: render card icons once (SVG sprite with `<use>`, or CSS) and/or show fewer than 100 products per page. | F5 | Smaller pages (likely several hundred KB less), faster render and first paint on mobile, less CPU per request. | Low: visual check needed. | NV |
| 5 | Trigram search: `pg_trgm` GIN index on `lower(name)` (and on SKU and description if they stay searchable). | F7 | Search stops scanning the whole catalog; most useful above ~50k. | Medium: needs the `pg_trgm` extension on the production Postgres (availability on Cloudways not checked) and a concurrent index build. | NV |
| 6 | Homepage: load all campaign products in one `findMany({ where: { promotionId: { in: ids } } })` and group them in memory. | F4 | One query instead of N; matters as campaigns grow. | Low. | NV |
| 7 | Favorites: one batch endpoint (`?ids=…`, capped) instead of one request per product. | F8 | N requests → 1 per favorites view. | Low. | NV |
| 8 | Legacy vendor `[section]` products/inventory: add pagination or remove the endpoint if no screen uses it. | F9 | Prevents a multi-MB response and a memory spike for a large store. | Low–medium: first check which screens still call it. | NV |

## 6. Cloudways Velocity: what has to be measured there

- Number of vCPUs and their speed. Node renders on one thread per process. The ~13 rps ceiling here is roughly one
  core's rendering plus database time, so a slower core lowers it directly. **NV**
- Whether Postgres runs on the same 3.82 GB server. Here the app process peaked at 924 MB under 300 visitors, before
  counting Postgres and the OS. **V (local); NV (Velocity)**
- Postgres `max_connections` and `shared_buffers`, and the Prisma pool the production `DATABASE_URL` actually gets. **NV**
- A short load run (1/5/10/25 visitors) against a staging copy on the same plan, never against the live shop. **NV**

## Open items (not done in this session)

1. **Smaller pool test (`connection_limit=5` at 5/10/25 visitors): not run.** The 5433 verify cluster was not
   running, and the standing rule is not to start it without approval. **NV**
2. **In-process cache test for `getPublicCategoryData`: not run** (same reason). No app code was changed. **NV**
3. **Scratch schema `scale_audit` on 127.0.0.1:5433 has not been dropped.** It stays on that cluster's disk until the
   cluster is running again. To drop it: `DROP SCHEMA scale_audit CASCADE;` on 5433 only. **V (not dropped)**
4. Done: the server on port 3110 was already stopped; `.next-scale` removed; `tsconfig.json` and `next-env.d.ts`
   identical to HEAD. **V**
