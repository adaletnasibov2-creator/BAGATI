# BAGATI production launch

This guide describes how to launch the current application. It does not provision hosting, change DNS, or enable live payments. Keep staging and production credentials in the host secret store. Do not commit them.

The application is not ready for real customers until the checklist at the end of this file is complete.

## Runtime shape

Run three separate processes. Do not rely on `npm run start` to send email or to migrate the database.

1. Web: `npm run start` after `npm ci`, `npx prisma generate`, and `npm run build`.
2. Email worker: `npm run email:worker:watch` with the same `DATABASE_URL`, `SESSION_SECRET`, and `EMAIL_ENCRYPTION_KEY` as the web process.
3. One-off migration: `npm run staging:migrate` only for a verified staging database. Production migrations need a separate reviewed command and a fresh backup. Do not run `db:push` or `migrate dev` on a deployed database.

Liveness is `GET /api/health`. Readiness is `GET /api/ready`. The ready endpoint reports database reachability and does not return the database error.

## Email

SMTP variables are `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`. Accepted ports are 465 and 587. A successful SMTP handshake does not prove inbox delivery.

Gmail SMTP is acceptable for a controlled test. It is a poor commercial sender because of mailbox limits, weak alignment with a marketplace domain, and spam-folder risk. Before launch, use a transactional provider that can send as the marketplace domain and publish SPF, DKIM, and DMARC for that domain.

The worker claims each outbox row with a compare-and-set update. A second worker cannot send the same pending row. A crash after the provider accepts a message is marked unknown and is not retried, so a message is not sent twice. Poll errors stay in the process and are visible through `npm run email:worker:health`.

Supervise the watch command as its own service:

- On Render, use a background worker with the staging or production start command `npm run email:worker:watch`, restart on failure, and one instance only.
- On a Linux host, use systemd with `Restart=on-failure`, `KillSignal=SIGTERM`, and a working directory at the deployed release. The process handles SIGTERM and writes `stoppedAt` to its heartbeat.
- On the current Windows host, use one Task Scheduler task as described in `docs/transactional-email.md`, with "Do not start a new instance".

Run the health command every minute from the same directory. Alert when it exits non-zero. The health command does not prove that a recipient inbox received mail.

Do not run `email:test-send` until the owner names a test inbox.

## Object storage

Production must set `BAGATI_STORAGE_DRIVER=s3`. Without that, production uploads throw `PRODUCTION_STORAGE_DRIVER_REQUIRED`. Local disk is for development.

Required server-only names: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and `S3_PUBLIC_BASE_URL`. `S3_SESSION_TOKEN` is optional. The client uses path-style addressing, so AWS S3, Cloudflare R2, and MinIO are compatible. Credentials stay on the server.

Recommended first production choice: Cloudflare R2, because the site already uses Cloudflare and the current client already speaks path-style S3. Use a private bucket, a token limited to the bucket, and a public CDN hostname in `S3_PUBLIC_BASE_URL`. Set `S3_REGION=auto`. AWS S3 plus CloudFront is the alternative when the rest of the stack is on AWS. MinIO is appropriate only for a self-managed durable volume with its own backups.

`npm run dev` stores files in `public/uploads`, which survives a restart and does not require cloud credentials. `npm run start` is production mode and fails closed until `BAGATI_STORAGE_DRIVER=s3` is complete, or until both `BAGATI_STORAGE_DRIVER=local` and `BAGATI_STORAGE_LOCAL_DURABLE=true` are set for a durable volume. Do not put the durable-local pair on the hosted production service.

`GET /api/ready` includes `storage` as `local`, `s3`, or `unconfigured`. The field contains no credentials. Uploads stay limited to three concurrent normalizations per process unless `BAGATI_STORAGE_PROCESS_LIMIT` sets another value from 1 to 8.

Database rows store the public URL. A database backup does not contain the image bytes. Back up the bucket separately.

No live R2 or S3 bucket is configured in the current environment, so a real cloud upload has not been verified. Create the bucket and the restricted token in the provider console, then put the values in the host secret store. Do not paste the secret into chat or into a committed file.

## Database recovery

Use the managed PostgreSQL backup feature for production. Enable daily snapshots and point-in-time recovery. Retain at least 14 days. Restore only into a new database name, never over the live database. After a restore, check migration status, foreign keys, and that the application can connect. Then decide whether to repoint the application.

The local command `node scripts/isolated-restore-drill.mjs` is a schema drill. It refuses every database except `bagati_restore_drill` and `bagati_restore_verify` on localhost port 5432. It does not read or write the `bagati` database. It does not prove that a backup of customer data can be restored. That proof has to be done on the managed staging database after the owner creates it.

Suggested production targets, as operational goals rather than measured results: recover to within 24 hours of the last completed snapshot (RPO), and complete a restore rehearsal in under 2 hours (RTO). Replace these with measured times after the first managed restore test.

## Payments and Google sign-in

Leave `EPOINT_PAYMENTS_ENABLED` unset until the owner supplies sandbox keys and the documented Epoint URLs, and a sandbox payment reaches `PAID` through the callback and status request. Do not put production merchant keys in the sandbox environment. Refunds stay unimplemented.

Google sign-in needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `APP_BASE_URL`. In production the origin host must be `shopbagati.com`. Register the redirect `{APP_BASE_URL}/api/auth/google/callback` and the same origin as an authorized JavaScript origin. The browser consent flow has not been completed.

## Deploy and rollback

1. Confirm the database backup finished.
2. Build in CI or on the host with `npm ci`, `npx prisma generate`, and `npm run build`.
3. Apply reviewed migrations to the target database before serving the new release.
4. Start the web process and the email worker.
5. Check `/api/health`, then `/api/ready`, then one customer login and one public catalog page.

Rollback is to the previous build directory and the previous environment. Do not delete the last good build. If a migration has already been applied, roll the application forward with a reviewed fix or restore the pre-migration snapshot into a new database and repoint only after that restore is verified. There is no automatic down migration.

## Launch checklist

- [ ] Managed PostgreSQL with backups, and one restore into a separate database.
- [ ] `APP_BASE_URL=https://shopbagati.com` on the production process.
- [ ] S3-compatible bucket and one seller image that survives a restart.
- [ ] Transactional email domain with SPF, DKIM, and DMARC, plus one received verification message and one received reset message.
- [ ] Supervised email worker and a failing health check that alerts a person.
- [ ] Epoint sandbox payment, callback, status check, and `PAID` order. Production flag remains off until a separate approval.
- [ ] Google consent completed, or the Google button hidden.
- [ ] `/api/health` and `/api/ready` monitored.
- [ ] Previous release kept for rollback.
