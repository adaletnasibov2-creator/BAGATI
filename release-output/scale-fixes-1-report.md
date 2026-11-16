# Scale fixes, part 1 — report

Date: 2026-11-16. Branch `feature/scale-fixes-1` (from `feature/scale-audit` at 2bec212). Not merged, not pushed.
V = verified (measured, or read in code); NV = not verified.

> **All numbers come from one local Windows machine with 12 logical cores**, with the app and PostgreSQL on the same
> machine and other programs running (VS Code, Edge). They are not Cloudways Velocity numbers. Velocity (3.82 GB RAM,
> vCPU count unknown) must be measured on its own; `docs/database-connection-pool.md` lists what to measure first.

## Commits

| Commit | What |
|---|---|
| fd1dc75 | `scripts/scale-audit/promotions.sql`: 8 active store campaigns × 50 products in `scale_audit`, so the homepage campaign query has data |
| cd81ce3 | Category counts: shared 30 s cache keyed by city, undefined/null/"" → one key, max 32 keys, generation guard, invalidation after commit |
| 7aac23a | Homepage: campaign products in one query instead of one per campaign |
| a912c1b | Favorites: `GET /api/products?ids=` (max 50) and the favorites page sends batches of 50 |
| f06bae0 | Legacy vendor `[section]` route: unreachable `products` GET and POST branches removed (PATCH kept) |
| bf49707 | Three static test assertions updated for the two changes above (see "Static tests") |
| 9b543ef | `docs/database-connection-pool.md` (no code) |

## What changed

### 1. Category counts cache — V
- `lib/keyed-ttl-cache.ts`:
  - 30 s TTL per key, at most 32 keys (oldest evicted).
  - Concurrent callers of one key share a single load.
  - **Generation guard:** a load that started before an invalidation is returned to its own callers but not stored.
  - Errors are not cached.
- `getPublicCategoryData` (`lib/public-category-tree.ts`):
  - **Key:** undefined, null and "" become one key.
  - **What is cached:** category rows and counts only. `catalog.showEmptyCategories` is still read on each call
    through the settings cache.
  - **Sharing:** the cache is kept on `globalThis`, so route handlers and pages share one instance.
  - **Comment:** BAGATI runs as one PM2 process. With more processes, each one has its own cache, and an invalidation
    reaches only the process that handled the write.
- **Invalidation after commit:**
  - all admin category writes (through `runCategoryAdmin` and the `[...resource]` category branches);
  - admin product status, product edit, store import and store activation;
  - seller product create, edit and archive, CSV import, and import job processing.
  - Seller archive (DELETE) was added beyond the Phase 0 list; it changes counts too.
- **End-to-end on the running after build, V:**
  - After an admin deactivated "Elektronika", `/products` and `/categories` dropped it on the next load (about 1.2 s
    for the check, against the 30 s TTL).
  - After reactivation it came back at once.
  - The homepage still showed a link to it because the hero carousel has a fixed link
    (`components/home/hero-carousel.tsx:45`), not because of the cache.
- **Within 30 s, not invalidated, NV:** store, subscription, city and user changes, and subscription periods ending.

### 2. Homepage campaign query — V
- One `promotionProduct.findMany` with an OR per campaign (campaign id + its own store + the same in-stock filter),
  ordered by product name then id. The first 10 per campaign are kept in memory (`groupCampaignProductRows`).
- **Output identical:**
  - The integration test (rolled back) compares old vs new with a campaign over 10 products, a foreign-store product,
    an out-of-stock product and a name tie.
  - The real homepage campaign shelf showed the same 10 products in the same order on both builds.
- **Database transactions per homepage request:** 97 → 71.

### 3. Favorites batch — V
- `GET /api/products?ids=a,b,c`:
  - More than 50 entries gives 400 (51 ids → 400, checked on the running server).
  - Invalid ids give 400.
  - Duplicates are removed.
  - Items come back in request order, with the same where, include and store eligibility as `/api/products/[id]`
    (shared include constant).
- The single endpoint stays.
- The favorites page drops invalid saved ids, then sends one request per 50.
- On the running server, `?ids=sp7,sp8,nope,sp7` returned `sp7,sp8`.

### 4. Legacy vendor `[section]` route — V (code)
- `app/api/vendor/[storeId]/products/route.ts` exports GET and POST, so `[section]`'s `products` GET (the unbounded
  list) and POST (legacy create) could not run. Both were removed, along with 5 imports only they used.
- The PATCH `products` branch stays, because `products/route.ts` exports no PATCH.
  - It is also unreachable in practice: Next.js answers 405 for PATCH on `/products`. NV, not exercised.
  - It has no store-eligibility check of its own.
- The inventory section is unchanged; its server-side paging is part 2.

### 5. Pool documentation — `docs/database-connection-pool.md`
No code change.

## Measurements at 50k products (`scale_audit`: 50,000 active products, 10 stores, 8 campaigns × 50 products)

### Why there are three result sets
1. **Sequential before → after** (`load.mjs`, 20 s per level, ascending): the requested method.
2. **A second before run** right after the after run, to check the machine.
   - It showed the machine had changed speed between runs: the old code scored about as well as the new, and often
     better (for example category at 25 visitors: 13.0 req/s old vs 3.9 new).
   - CPU sampling during that run showed 60–88 % background load and the clock moving between about 140 % and 173 %
     of base.
   - **So the sequential comparison in table 1 is not a valid before/after result on this machine.** It is kept
     below for completeness.
3. **Interleaved A/B (table 2): the result to use.**
   - Both builds ran at the same time (before on :3110, after on :3111), and only one was loaded at a time.
   - For every page and level the rounds alternated before/after/after/before (4 rounds × 10 s each), so drift
     affected both builds equally.
   - The scratch script is not committed.
4. **Database work per request (table 3).** Rows read and transactions from `pg_stat_database` over 20 sequential
   requests per page. These do not depend on CPU speed.

### Table 2 — interleaved A/B (requests/s · p50/p95 ms; error rate before / after) — V

| Page | Visitors | Before | After | Throughput | Errors |
|---|---|---|---|---|---|
| Home `/` | 1 | 4.3 · 232/262 | 3.6 · 276/321 | −16 % | 0 / 0 % |
| | 5 | 10.5 · 483/529 | 10.3 · 487/547 | −2 % | 0 / 0 % |
| | 10 | 11.0 · 954/1070 | 12.0 · 872/956 | +9 % | 0 / 0 % |
| | 25 | 12.5 · 2399/2671 | 12.5 · 2187/2444 | 0 % | 0 / 0 % |
| Category `/products?category=elektronika` | 1 | 6.2 · 159/194 | 5.5 · 166/294 | −11 % | 0 / 0 % |
| | 5 | 10.3 · 405/1377 | 11.8 · 356/1006 | +15 % | 0 / 0 % |
| | 10 | 4.0 · 2996/3839 | 8.3 · 668/3080 | +108 % | 0 / 0 % |
| | 25 | 4.8 · 7381/9134 | 5.0 · 5483/11180 | +4 % | 6.3 / 2.4 % |
| Product `/products/sp7` | 1 | 6.4 · 172/251 | 12.4 · 79/125 | **+94 %** | 0 / 0 % |
| | 5 | 40.0 · 123/147 | 62.7 · 78/91 | **+57 %** | 0 / 0 % |
| | 10 | 20.0 · 221/1316 | 35.5 · 156/578 | **+78 %** | 0 / 0 % |
| | 25 | 11.9 · 2202/3070 | 20.7 · 1224/1783 | **+74 %** | 0 / 0 % |
| Search `/products?q=Smartfon` | 1 | 2.3 · 472/668 | 2.0 · 510/623 | −13 % | 0 / 0 % |
| | 5 | 3.0 · 1769/2268 | 4.0 · 1267/2044 | +33 % | 0 / 0 % |
| | 10 | 3.8 · 3111/3985 | 5.3 · 2416/3335 | +39 % | 0 / 0 % |
| | 25 | 4.8 · 7187/9103 | 5.0 · 6431/7854 | +4 % | 3.5 / 0 % |

Reading:
- **Product page: a clear gain at every level.** Its main database cost was the category counts from the layout,
  which are now cached.
- **Category and search:** better at 5–10 visitors. At 25 the page saturates on the full listing scan (finding F1 of
  the audit, still open), so the cache barely helps.
  - The 5xx at 25 visitors dropped from 6.3 % to 2.4 % on category and from 3.5 % to 0 % on search.
- **Homepage: no throughput change.** It reads 1.6 million rows per request from its other queries (table 3), so
  removing the counts and 7 campaign queries does not show.
- **At 1 visitor**, after was 11–16 % slower on home, category and search. This is within the spread seen between
  rounds, but it is consistent across three pages. Cause not identified. NV
- Memory peaked at 834–891 MB in all runs. Database connections peaked at the pool size (17) in all runs.

### Table 3 — database work per request (20 sequential requests per page) — V

| Page | Rows read before | Rows read after | Change | Transactions before → after |
|---|---|---|---|---|
| Home `/` | 1,784,474 | 1,617,203 | −9 % | 97 → 71 |
| Category `/products?category=elektronika` | 430,608 | 178,700 | **−58 %** | 22.8 → 6.0 |
| Product `/products/sp7` | 144,303 | 48,974 | **−66 %** | 25.0 → 16.2 |
| Search `/products?q=Smartfon` | 350,493 | 179,115 | **−49 %** | 21.9 → 7.5 |
| `/categories?category=elektronika` | 462,436 | 272,630 | **−41 %** | 32.9 → 18.2 |

- "Rows read" = `tup_returned + tup_fetched` from `pg_stat_database`. Background noise: 657 rows and 7 transactions
  over 3 s idle, which is negligible.
- With the cache, the 20 requests (well under 30 s) loaded the counts once; that is the effect being measured.

### Table 1 — sequential runs (not a valid comparison, see above) — V (as measured)

requests/s · p50/p95 ms. Before = first run, After, Before again = old code rerun right after.

| Page | Visitors | Before | After | Before again |
|---|---|---|---|---|
| Home | 1 / 5 / 10 / 25 | 1.4 · 711/756 · 2.2 · 2337/2893 · 2.0 · 4654/5604 · 2.3 · 10180/13564 | 1.1 · 899/1021 · 2.5 · 1995/2148 · 11.9 · 839/902 · 4.8 · 2690/9050 | 4.7 · 211/241 · 10.9 · 455/488 · 11.1 · 893/972 · 11.0 · 2256/2400 |
| Category | 1 / 5 / 10 / 25 | 1.9 · 516/597 · 2.5 · 1919/2291 · 2.8 · 3500/4147 · 2.9 · 9231/11505 (18 % errors) | 1.8 · 553/764 · 3.9 · 1298/1437 · 15.8 · 621/719 · 3.9 · 6250/7129 | 6.7 · 148/175 · 13.1 · 383/413 · 13.3 · 742/817 · 13.0 · 1914/2010 |
| Product | 1 / 5 / 10 / 25 | 4.2 · 230/308 · 8.4 · 565/819 · 10.3 · 966/1236 · 9.7 · 2567/3717 | 8.5 · 116/149 · 47.1 · 83/263 · 51.9 · 159/455 · 20.6 · 1197/1365 | 12.4 · 80/96 · 44.4 · 111/129 · 48.8 · 202/228 · 49.0 · 506/663 |
| Search | 1 / 5 / 10 / 25 | 2.0 · 492/629 · 4.0 · 1562/1795 · 2.5 · 3691/4747 · 2.9 · 9370/9857 (3.9 % errors) | 2.2 · 454/517 · 15.1 · 332/360 · 4.4 · 2203/2723 · 11.8 · 1510/6409 | 7.1 · 139/162 · 13.7 · 364/391 · 13.7 · 729/769 · 10.5 · 2170/3664 |

The first "before" run is 3–4× slower than the rerun of the same code. That is the machine, not the code.

## Tests

- **Full baseline after the last code change:** 882 unit tests, 878 pass, **4 fail**; 59 mjs tests, 58 pass,
  **1 fails**. These are the same 4 + 1 failures as on 2bec212:
  - unit: bulk import, admin product imports, admin product publishing, public discovery;
  - mjs: the admin store-management test that needs a running local server.
  - Their failure messages were checked as unchanged.
  - Integration tests excluded as usual.
- New unit tests:
  - `scripts/public-category-cache.test.ts` (11): hit, shared in-flight load, TTL expiry, invalidation, generation
    guard, errors not cached (also synchronous throw), same key for undefined/null/"", different cities, 32-key cap,
    setting read per call, callers get their own copies.
  - `scripts/public-product-batch.test.ts` (6): 50 cap (duplicates counted), invalid ids, order, eligibility filter,
    one query per batch, client batching of 50, static check of both endpoints.
  - `scripts/homepage-campaign-products.test.ts` (+2): grouping equals per-campaign slicing; the page uses the
    single query.
- New integration tests, run on 127.0.0.1:5433 schema `scale_audit`, both pass, both roll back:
  - `scripts/homepage-campaign-query.integration.test.ts`
  - `scripts/public-product-batch.integration.test.ts`
- Typecheck clean. ESLint: 0 errors; no new warnings in the changed files.

### Static tests that broke because of approved changes (commit bf49707, for your review)
1. `scripts/admin-store-management.test.ts:373` matched the exact text of the category DELETE branch. It now matches
   the same call followed by `invalidatePublicCategoryCache()`.
2. `scripts/product-category-choice.test.ts:51` expected 2 category checks in `[section]` ("legacy create and patch").
   Now 1 (legacy patch), plus a new assertion that no legacy create path is left.
3. `scripts/public-store-eligibility.test.ts:153` required the eligibility check that lived in the removed legacy
   create branch. The entry is replaced by an assertion that `[section]` no longer creates products that way. Seller
   creates stay covered by the `products/route.ts` entry.

None of them asserts less about code that still exists.

## Findings for part 2 (not fixed here)

| Finding | Status |
|---|---|
| **Homepage reads about 1.6 million rows per request** at 50k products after this change (table 3). Its other queries (newest, discount candidates, popular items, campaign existence subqueries, featured) need EXPLAIN. | V (rows); NV (which query) |
| **`GET /api/products` catalog list fails with 500 at 50k** on the before and the after build. `findPublicProductCatalogPage` with `exactTotal: true` runs past the 5 s interactive-transaction limit (P2028). Which screens call it was not checked. | V (500 on both builds); NV (callers) |
| Listing pages still scan every active product (audit F1); category and search saturate at about 5 req/s at 25 visitors. | V |
| Seller inventory panel: server-side paging (Phase 0, option b). | V (code) |
| The kept legacy PATCH `products` branch of `[section]` is unreachable and has no eligibility check. Candidate for removal once confirmed with a request. | V (code); NV (runtime) |

## Housekeeping
- Build dirs `.next-scale-before` and `.next-scale-after` removed after the measurements.
- `tsconfig.json` and `next-env.d.ts` restored after each build.
- Schema `scale_audit` kept on 127.0.0.1:5433, now including the 8 fixture campaigns (`scale-promo-*`).
- Measurement scripts and raw logs stay in the session scratchpad: `interleaved.mjs`, `dbwork.mjs`,
  `invalidation-e2e.mjs`, `load-*.log`.
- Secret scans were run per commit (file:line:pattern). One hit:
  - `docs/database-connection-pool.md:12:postgresql://` — the placeholder example
    `postgresql://USER:PASSWORD@HOST:5432/DBNAME…`, not a credential.
  - That commit was made in the same command as the scan, before the hit was reviewed; it was reviewed afterwards.
