# BAGATI staging deployment runbook

## Scope and safety

This is a staging-only preparation guide. No provider resources are provisioned by this file. Never use the production `.env`, production database URL, production storage bucket, or production secrets in a staging service.

The current local `DATABASE_URL` was checked without printing its host or credentials; its database name is `bagati`. Do not run migrations, seeds, database-backed tests, or the production build with that local configuration.

## Target architecture

Use one Render region for these staging resources:

1. Managed PostgreSQL database named exactly `bagati_staging`; select PostgreSQL 16, enable the available backup/PITR option, and keep public inbound access disabled unless a reviewed operational need requires it.
2. Node.js Web Service running the existing Next.js server (`npm run start`).
3. A separate one-off migration job started manually only after the database host/name have been verified and a staging snapshot exists.
4. A dedicated S3-compatible staging bucket with an independent least-privilege key.
5. A separately supervised email worker only after an isolated non-delivering mail sink has been approved and configured. Until then, leave SMTP unset and do not start the worker.

This repository does not contain a Render blueprint, deployment workflow, or production payment provider. Choose the exact Render-supported Node 22 LTS patch in the provider dashboard after checking native Sharp compatibility. Current price, region availability, backup retention, and plan limits must be confirmed in Render before provisioning.

Provider references: [Render PostgreSQL setup and connection URLs](https://render.com/docs/postgresql-creating-connecting), [Render Next.js deployment](https://render.com/docs/deploy-nextjs-app), and [Render Node version selection](https://render.com/docs/node-version). Render documents PostgreSQL 13–18 for new databases and same-region internal URLs; PostgreSQL 16 is a staging recommendation, not a version already tested against a provisioned Render instance.

## Render Web Service

- Build command: `npm ci && npx prisma generate && npm run typecheck && npm run build`
- Start command: `npm run start`
- Health check path: `/api/health` (liveness only; it deliberately does not query PostgreSQL)
- Region: same as the staging PostgreSQL database.
- Runtime `DATABASE_URL`: Render's **internal** URL for `bagati_staging`; do not use the external URL for an in-region service.
- Do not configure production secrets, production database URLs, or real SMTP/payment credentials in this service.
- `npm run build` runs `prisma generate` before `next build`, so a host that keeps `node_modules` between deploys still builds against the current schema. It needs no database connection and never migrates. There is still no postinstall generation hook.
- Migration must finish before deploying code that queries the new homepage tables. Do not make the web service run migrations on startup or as an automatic unreviewed pre-deploy step.

The health endpoint proves only that the web process responds. It does not prove database, email, or storage readiness; validate each separately in staging.

## Environment configuration

Use `.env.staging.example` only as a list of variable names. Store actual values in Render's encrypted environment/secret manager; do not fill or commit a local staging env file.

Required by the web app:

- `DATABASE_URL`: staging-only PostgreSQL URL, database name exactly `bagati_staging`.
- `SESSION_SECRET`: unique staging random secret, at least 32 characters.
- `BAGATI_STORAGE_DRIVER=s3` and `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`: staging bucket only. `S3_SESSION_TOKEN` is optional.
- Optional `EMAIL_ENCRYPTION_KEY`: staging-only stable key if explicitly configured; otherwise it is derived from `SESSION_SECRET`.
- Optional public map variables: `NEXT_PUBLIC_MAP_TILE_URL`, `NEXT_PUBLIC_MAP_TILE_ATTRIBUTION`.

Migration job safety variables:

- `BAGATI_ENV=staging`
- `BAGATI_STAGING_CONFIRM=bagati-staging` (set only for the reviewed, one-off migration job)
- `BAGATI_STAGING_DATABASE_HOST`: exact hostname copied from the staging provider panel, without credentials or port.
- `DATABASE_URL`: same staging database URL used by the controlled migration job.

The `staging:migrate` command fails closed unless the environment marker, explicit confirmation, exact `bagati_staging` database name, remote PostgreSQL protocol/host, and exact expected-host match are all present. It does not print the URL. The host/name checks reduce mistakes but do not replace a human checking the Render resource identity before every migration.

Email:

- Initially leave all `SMTP_*` variables unset and do not run `email:worker:watch`; it processes the database outbox and may send email.
- Only after approval, configure a sink/test transport restricted to test recipients. Run the worker as a separate Render background service with staging `DATABASE_URL`, a matching `SESSION_SECRET`/`EMAIL_ENCRYPTION_KEY`, and sink-only SMTP credentials.
- Do not run SMTP connectivity/delivery checks against real accounts as part of staging setup.

Payment:

- Epoint code is present and stays disabled unless `EPOINT_PAYMENTS_ENABLED=1` and the full sandbox configuration are set. Do not set that flag for staging or production until a sandbox payment, callback, and status reconciliation have been completed. The admin payments page does not charge a card.

## Database provisioning and migrations

1. In Render, manually create a **new** PostgreSQL resource in the selected region. Set its database name to exactly `bagati_staging`. Do not clone or restore production data; use synthetic test fixtures.
2. Enable backups/snapshots before schema changes. Record the resource name and host separately; never paste credentials into chat, source, logs, or tickets.
3. Add staging-only service secrets. For the migration job, set `BAGATI_STAGING_DATABASE_HOST` from the provider panel and independently verify it matches the URL host. Do not use local `.env`.
4. From the staging deployment environment, run `npm run staging:migrate` only after a human verifies the Render database resource is the staging resource and a current snapshot exists.
5. Verify `prisma migrate status`, app health, admin authorization, and core flows using only test accounts. Never use `db:push`, `migrate dev`, `db:seed`, or reset commands in a deployed environment.
6. If the guard refuses, stop and inspect configuration without weakening the guard. Do not substitute the main database URL.

The newest committed migration is `20261022000000_storefront_branding`. Earlier review of the history through `20261012120000_admin_homepage_management` found no destructive data statements in that range. Review each later migration before applying it. There is no down migration; recover by restoring a snapshot or applying a reviewed forward migration.

## Storage, backup, and restore

- Create a separate bucket such as an explicitly named staging bucket; never share the production bucket, public URL, or access key.
- Limit the key to the staging bucket and required object operations/prefix. Confirm public URL behavior and HTTPS.
- Verify upload, retrieval, deletion, and persistence across a staging redeploy. No live S3/CDN integration has yet been verified.
- Configure database snapshot/PITR retention appropriate to the selected plan. Restore a snapshot into a separate isolated database and verify application access before relying on it.
- Treat object storage and encryption keys as separate backup/restore concerns; database snapshots do not contain uploaded images or recover secrets.

## Staging verification checklist

- [ ] Confirm the Render database name is `bagati_staging`, its region matches the web service, and its host matches the migration job allow-check.
- [ ] Run DB-independent checks: `npm run test:staging-migration`, `npm run test:staging-health`, `npm run test:admin-product-management`, `npm run test:commission-rules`, `npm run test:admin-report-csv`, `npm run test:admin-homepage`, `npm run test:admin-sales-report`, `npm run test:promotions`, `npm run typecheck`, `npm run lint`.
- [ ] Take a staging snapshot, run the guarded migration job once, and verify migration status.
- [ ] Deploy the web service; verify `/api/health` returns HTTP 200, then verify DB-backed pages against staging.
- [ ] Create only synthetic admin, vendor, and customer accounts; test site settings, banner schedule/activation, featured products/stores, and authorization failures.
- [ ] Test image validation and persistence with staging storage only.
- [ ] Keep email outbox-only until an isolated sink is approved; do not run the worker before then.
- [ ] Keep payment disabled. No real payment or refund test is allowed.
- [ ] Restore a staging backup into a separate disposable database and record the result.
- [ ] Re-run dependency audit; current known build-tooling advisories remain a release risk in `docs/staging-readiness.md`.

Browser E2E tooling is not currently installed in the project. The admin/site-content browser scenarios must be run after staging is deployed with an approved browser-test setup; no browser E2E is claimed by this runbook.

## Human actions still required

- Create the Render account/resources and decide the region/plan after checking current provider details.
- Create the `bagati_staging` database and dedicated staging bucket.
- Add generated staging-only secrets in Render; do not send them to the assistant or commit them.
- Confirm whether a non-delivering email sink is needed; otherwise keep the worker stopped.
- Approve the migration only after independently verifying database identity and snapshot.
- Set up the Git remote/branch used for Render deployments; this workspace currently has no `.git` directory and no Git executable available in the environment.
