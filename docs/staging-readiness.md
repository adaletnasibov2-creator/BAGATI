# BAGATI staging readiness

Status: planning only. No hosting, database, storage, SMTP, or payment provider has been provisioned or contacted for this plan.

## Verified project constraints

- BAGATI is a Next.js 15 App Router application using Node.js, TypeScript, React 19, PostgreSQL, Prisma 6, and Zod.
- The Prisma datasource reads `DATABASE_URL`. There is no `DIRECT_URL`, `directUrl`, Prisma config file, container definition, or hosting/deployment manifest in the current project.
- `package.json` defines `db:generate`, `db:push`, `db:migrate` (`prisma migrate dev`), and `db:seed`; it does not define a deployment migration command or a Prisma-generation `postinstall` hook.
- A committed Prisma migration history exists under `prisma/migrations`. The README's local setup uses `db:push`; that is not the production deployment procedure.
- The app's `start` script is `next start`. The transactional email worker is a separate process; starting the web app does not start it.
- Local uploads are written under `public/uploads/vendors/<storeId>`. Production local storage is rejected unless `BAGATI_STORAGE_LOCAL_DURABLE=true`. S3-compatible storage support is implemented, but no live bucket/CDN configuration or integration has been verified.
- `getPaymentProvider()` currently returns `null`. Payment-provider environment variables and a real payment integration are not present.
- No deployment, backup, restore, or hosting service has been configured or tested as part of this plan.

## Admin readiness implementation update (2026-10-12)

- Existing product editing now has an ADMIN-only API/UI for product fields, existing variants, prices, store-owned image URLs, and inventory quantities. Inventory cannot be reduced below reserved units; stock adjustments and edits are audited. Product creation and variant add/remove remain out of scope.
- An ADMIN-only campaign manager now uses the existing `Promotion` tables and pricing behavior. It supports create/edit/deactivate for selected active products in an active store, validates dates and discounts, and checks overlapping active promotions inside a serializable database transaction. Campaign deletion is soft (deactivation).
- Commission create/update now rejects overlapping rules for the same store inside serializable transactions. Existing records are not rewritten. CSV reports are available from `/admin/reports` through an ADMIN-only endpoint, use the current refund-aware sales/commission calculations, escape spreadsheet formula strings, and limit exports to 366 days.
- The new work changes no Prisma schema and adds no migration. Validation used DB-independent helper/route-wiring tests and a production build with an intentionally unreachable dummy DB target. No migration, seed, email worker, payment, or live storage operation ran. The local `DATABASE_URL` continues to target the main `bagati` database and was not used for build/tests.
- Typecheck and focused admin/campaign/report tests passed. Lint completed without errors; pre-existing `no-explicit-any` warnings remain in the admin catch-all page and other code. Production build generated all 30 static pages. Browser E2E and staging DB-backed API checks remain unverified.

## Hosting comparison

| Option | Fit for this project | Main trade-offs | Planning cost category |
|---|---|---|---|
| Render-style managed Node web service + separate background worker + managed PostgreSQL + S3-compatible object storage | Good straightforward fit for `next start`, Prisma, and the always-running outbox worker. Keep web, worker, and database in the same supported region/network. | Confirm the selected service supports the required Node/Sharp runtime, worker supervision, persistent database backups, private networking, and deployment-time commands. | Staging: low, usually a small monthly bill across web, worker, database, and storage. Production: low-to-medium initially, rising with database size, availability, and traffic. |
| Railway-style app service + worker service + managed PostgreSQL + object storage | Good fit where services/processes can be deployed independently from the same project. | Usage-based totals can vary; confirm PostgreSQL backup/restore and connection/pooling behavior, service health checks, and secret scoping. | Staging: low-to-medium usage-based. Production: medium as redundancy, database, and egress needs grow. |
| Vercel-style Next.js hosting + external managed PostgreSQL + separately hosted worker + object storage | Strong Next.js deployment experience; viable if the app's server runtime and Prisma deployment are validated on the chosen plan. | The current long-running email worker needs a separate host/process; database, worker, and storage are separate services. Serverless connection limits/pooling and native Sharp/runtime compatibility require explicit validation. | Staging: low-to-medium, often several independently billed services. Production: medium and split across vendors. |

These are architecture comparisons, not vendor endorsements or current quotations. Exact prices are not verified; region, service sizes, backup retention, storage, bandwidth, and provider pricing must be checked before choosing. Do not buy a domain or service as part of this plan.

### Recommended target architecture

For the current implementation, start with a conventional Node.js host that provides:

1. One Next.js web service running `next start`.
2. One separately supervised Node worker for `npm run email:worker:watch`, enabled only after a non-delivering staging mail sink or explicitly approved test SMTP is selected.
3. A dedicated managed PostgreSQL **staging database**, separate from both the main `bagati` database and any future production database.
4. S3-compatible object storage for vendor uploads, with separate staging and production buckets/credentials and a CDN/public HTTPS URL only if needed.
5. Platform secret storage scoped separately to staging web, staging worker, and deployment/migration jobs.

Render-style managed Node services are a practical first option to evaluate because the web process, persistent worker, and PostgreSQL can be represented separately. Railway is a reasonable alternative. Select neither until current region availability, pricing, backup/restore, networking, and worker behavior are confirmed.

## Environment variables and secret ownership

Only configure variables actually used by this code. Values belong in the hosting provider's encrypted secret/environment store, not in source, build logs, client bundles, or `NEXT_PUBLIC_*` variables.

| Variable | Where it is used | Staging guidance |
|---|---|---|
| `DATABASE_URL` | Prisma datasource, application database client, workers, Prisma CLI | Required. Use a dedicated staging database identity and credentials. Runtime and migration-job values may differ, but both must target staging. No production URL in preview builds or tests. |
| `DIRECT_URL` | Not referenced by `prisma/schema.prisma` or application code | Not currently required or read. Do not add it as if supported. If a provider requires a distinct direct migration connection alongside a runtime pooler, first make a deliberate schema/config change and test it; alternatively run the current migration command with a direct staging URL. |
| `SESSION_SECRET` | Session signing and fallback outbox encryption key | Required at runtime; at least 32 characters. Generate an independent random staging value; never reuse local, test, or production secrets. Changing it invalidates sessions and, if used as the fallback encryption key, can make queued email payloads unreadable. |
| `EMAIL_ENCRYPTION_KEY` | Encrypted email outbox payloads | Optional in code; if supplied, exactly 32 random bytes encoded as 64 hex characters or base64. Prefer a separate stable key for staging and production. Back it up securely; rotation needs an outbox re-encryption plan. If omitted, the key is derived from `SESSION_SECRET`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | SMTP transport and admin delivery status | Required only to send email. Supported ports are 465 and 587. Initially leave unset and verify that messages are queued, or route only staging mail to a controlled non-delivering sink/test account after explicit approval. Do not point a staging worker at a shared/production outbox. |
| `BAGATI_STORAGE_DRIVER` | Vendor asset storage selection | Set to `s3` for staging. In production, no value defaults to an error rather than S3. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL` | S3-compatible store asset adapter | Required when the driver is `s3`. Use a staging-only bucket and least-privilege credentials limited to that bucket and `vendors/*`. Require HTTPS for non-local production endpoints and public URLs. |
| `S3_SESSION_TOKEN` | S3-compatible temporary credentials | Optional; use only if the selected provider issues temporary credentials. |
| `BAGATI_STORAGE_LOCAL_DURABLE` | Local asset storage guard | Not a substitute for object storage on ephemeral hosts. Set to `true` only if local uploads are on a durable, shared volume and the app serves that volume correctly. Prefer S3-compatible storage for staging. |
| `SMTP_*` and S3 values | Worker and web process | Share only the specific values needed by each service; the email worker needs SMTP and database access, but does not need S3 credentials unless its code later requires them. |
| `NEXT_PUBLIC_MAP_TILE_URL`, `NEXT_PUBLIC_MAP_TILE_ATTRIBUTION` | Public map UI configuration | Optional, non-secret browser-visible settings if map tile configuration is used. Never put keys or credentials here. |
| `BAGATI_SELLER_LEGAL_POLICY` | Optional server-side seller legal-field policy override | Configure only if staging needs a policy different from the built-in defaults; provide valid JSON and review it as application configuration. |
| `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD` | One-time admin bootstrap scripts only | Do not keep as web/worker runtime secrets. If needed, use a separately approved one-time staging-only provisioning job after verifying its database target, then remove the values. |
| `BAGATI_NEXT_DIST_DIR` | Next.js build output directory | Optional build/test isolation setting; ordinarily omit in deployment. |
| `BAGATI_BASE_URL` | Local security smoke-test scripts | Test-only; not an app runtime configuration variable. |

No password-reset configuration or payment-provider variable exists in the current code. Do not invent provider variables before implementing and reviewing an integration.

## Build and database deployment procedure

### Build

The project has no `postinstall` Prisma generation hook. A controlled build pipeline should:

1. Install exactly from the lockfile with `npm ci`.
2. Run `npx prisma generate` explicitly.
3. Run typecheck, lint, and applicable automated tests.
4. Run `npm run build`, then deploy the built application and start it with `npm run start`.

Do not supply production database credentials to a build job. Use a non-production build-time environment; if any build step needs a database, it must be an isolated staging database. Verify the target before any DB-backed command.

### Migration

Use the committed `prisma/migrations` history and a reviewed one-shot deployment job running `npx prisma migrate deploy` against the **staging** URL. Do not use `db:push`, `migrate dev`, or `db:seed` in deployment. The application must not run migrations automatically on startup.

Before applying a staging migration:

- review the SQL and expected compatibility/locking impact;
- verify the resolved host/database identity is staging;
- take a staging backup/snapshot;
- apply once from a controlled job and verify migration status and core flows.

Production must be a different database with different credentials and secrets. Promote only after staging validation and an explicit human approval. Back up production immediately before its separately approved migration. Prefer additive/expand-contract migrations for changes that must coexist with old and new application versions. Do not assume a down migration is safe; document a forward-recovery plan.

### Backup and restore

- Staging: enable provider snapshots before schema changes and set a modest retention policy appropriate to disposable test data. Do not copy production customer data into staging; use synthetic or sanitized fixtures.
- Production: require automated encrypted backups and point-in-time recovery if offered, defined retention, restricted backup access, and a documented restore runbook.
- Before relying on backups, restore one to an isolated database and verify the application can read it. A backup that has not been restore-tested is not proven recoverable.
- Keep DB backups, object-storage data, and encryption keys covered by a retention/restore plan. Database snapshots alone do not back up product images or decrypt queued email payloads.
- Set explicit recovery-point and recovery-time objectives before selecting production tiers; none are currently defined in project files.

## Upload, email, payment, and dependency risks

- **Uploads:** local mode writes into the application directory and may lose data on ephemeral redeploys/restarts. Production local mode has an explicit durability guard. The S3 adapter is implemented and unit-tested with mocked commands, but no live S3/CDN provider has been verified. Before staging, create a dedicated bucket and test upload, public retrieval, deletion, and restore behavior using staging-only data and credentials.
- **Email:** the app writes encrypted messages to PostgreSQL outbox; the worker is a separate process and is not auto-started by `npm run start`. Without the worker, queued verification messages remain pending. SMTP acceptance is not inbox delivery, and the project documentation notes SMTP/outbox cannot guarantee exactly-once delivery. Do not start the worker against a shared database. No SMTP service has been tested for staging.
- **Payment:** no provider is configured; `getPaymentProvider()` returns `null`. Checkout must not be treated as real payment capability. Payment integration, verified webhooks, reconciliation, refunds, and provider credentials are out of scope for staging infrastructure preparation.
- **Dependency advisories:** retain these in the staging risk register; no new fix is claimed here. The last clean-install audit snapshot (2026-10-11) reported 9 transitive findings: 7 HIGH and 2 MODERATE, with `npm audit --omit=dev` reporting zero. The underlying open advisories were `GHSA-vfj7-8cjw-p6xm` (braces stack-exhaustion DoS through Tailwind/ESLint build tooling; installed `braces@3.0.3`) and `GHSA-rj75-hqrm-r3gf` (selector parsing CPU-exhaustion risk through Tailwind; installed `postcss-selector-parser@6.1.4`). The locked `deepmerge-ts@8.0.2` override under Prisma config and Next nested `postcss@8.5.29` override were verified in that clean install. A prior deepmerge PoC had a contradictory `RangeError` result whose cause remains unresolved. Re-run the audit before staging deployment and record the result; do not treat the earlier production-only zero as proof that all build-tooling advisories are resolved.

## Staging entry checklist

- [ ] Choose a hosting region and compare current prices, Node/Sharp support, worker supervision, networking, and backup/restore capability.
- [ ] Provision separate staging PostgreSQL and object-storage resources; do not reuse the main `bagati` database, credentials, or buckets.
- [ ] Create independent staging secrets in the host's secret manager; exclude them from source control, browser variables, and logs.
- [ ] Decide whether staging email remains outbox-only or uses an explicitly approved isolated mail sink/test account. Keep payment disabled.
- [ ] Configure a staging-only migration job and require human review/approval.
- [ ] Run an isolated `npm ci`, Prisma generation, checks, build, migration dry review, and post-deploy smoke/E2E tests before inviting users.
- [ ] Test database restore and object-image persistence. Record advisory exceptions and owners before any external staging exposure.

No step above has provisioned infrastructure or changed the application's deployment configuration.

## Local deployment-preparation checks (2026-10-12)

These checks were local only; they did not create hosting resources or connect to an external service.

- **Git:** the workspace contains no `.git` directory and the `git` executable is unavailable in the current environment. Branch, commit, and tracked/untracked change status therefore could not be inspected. No commit or push was attempted.
- **Build/start commands:** `npm run build` completed successfully with Next.js 15.5.27 and generated 29/29 static pages. To avoid using any configured database, the build process received a deliberately unreachable `DATABASE_URL`; no database-backed integration tests or migration commands were run. The build output was directed to a temporary relative `BAGATI_NEXT_DIST_DIR` and removed afterward.
- **Build side effect:** Next.js added the temporary build directory's type path to `tsconfig.json` during the build. That generated include entry was removed immediately afterward; no intended `tsconfig.json` change remains.
- **Start:** the documented `npm run start` target (`next start`) opened a local TCP listener against the temporary build output. No HTTP request was sent, so no application route or database-backed handler was invoked. The temporary server and build output were stopped/removed.
- **Typecheck:** `npm run typecheck` passed.
- **Lint:** `npm run lint` exited successfully with 0 errors and 285 warnings. These warnings remain for later cleanup; the lint rules were not changed.
- **Migration:** no migration, schema push, seed, or database inspection was run. For staging, first provision and verify a dedicated staging PostgreSQL database, then have a reviewed, one-shot deployment job run `npx prisma migrate deploy` against only that staging target. Never put the main or production database URL in build or preview environments.
- **Outbox worker:** the separate process command is `npm run email:worker:watch`. It was not started because it reads and sends eligible messages from the configured database outbox. Configure it only as a separate staging service after its database target and non-delivering/approved email transport are confirmed.
- **Storage:** no files or storage configuration were changed. Use a dedicated staging S3-compatible bucket with independently scoped credentials and validate upload, retrieval, deletion, and persistence before relying on staging images.

At this check, the local production build/start commands and static checks are verified. Staging PostgreSQL, secrets, migrations, email transport/worker, object storage, backups/restores, hosting selection, and deployment remain unconfigured and unverified.

## Staging guard and runbook preparation (2026-10-12)

- No staging database or hosting account was provisioned. The configured local `DATABASE_URL` was inspected without printing its host or credentials; its database name is `bagati`.
- Added `.env.staging.example` with blank values only and `docs/staging-deployment.md` with Render-oriented setup, migration, worker, storage, backup, and manual verification instructions.
- Added `npm run staging:migrate`. It refuses to invoke Prisma unless `BAGATI_ENV=staging`, the explicit one-shot confirmation is present, the URL is PostgreSQL, the remote database name is exactly `bagati_staging`, and the host matches the separately configured `BAGATI_STAGING_DATABASE_HOST`. It never displays the URL.
- Added DB-independent tests for the migration guard and liveness endpoint. No migration, seed, DB-backed test, email delivery, payment, storage mutation, or hosting operation was performed.
- Added `/api/health`; this is a liveness response only and does not claim DB/storage/worker readiness.
- The admin navigation previously linked `/admin/payments` without a specific page. It now displays an explicit notice that no payment provider or transaction API is configured; it does not simulate transactions.
- The first isolated build exposed that root metadata looked up DB-backed site settings during prerender, which failed with a deliberately unreachable database. Root metadata now waits for request-time rendering with Next.js `connection()` before reading settings; the final isolated build completed with 30/30 static pages without connecting to any database. This avoids broad root-level dynamic-rendering configuration.
- `npm run typecheck` and `npx prisma validate` passed. Prisma validation only checked schema and did not connect to a database. The full lint command passed with 0 errors and 285 existing warnings.
- The DB-independent unit/admin test batch passed 115/115 tests; new staging migration guard tests passed 4/4, health endpoint test passed 1/1, homepage/admin tests passed 8/8, and vendor creation/verification-link tests passed 9/9. Auth and order-inventory database integration suites were intentionally not run because no isolated DB target is available.
- Static migration review found only additive table/index/FK creation in the homepage migration and no destructive `DROP`, `TRUNCATE`, or `DELETE FROM` statements across committed migration SQL. The migration history has no down migrations; restore/forward recovery remains the rollback approach.
- Current migration target is still the main local `bagati` database. Production build and any DB-backed operation remain blocked until a separate staging target is provisioned and verified.
