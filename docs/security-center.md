# BAGATI Security Center

## Current behavior and limits

The admin page at `/admin/security-center` displays only records stored in the `SecurityEvent` table. It does not create sample events. Overview totals and distributions are database aggregates over the selected server-side window (1 hour, 24 hours, 7 days, or 30 days); event filters apply only to the paginated event list. An empty aggregate after a successful database query means no matching records were stored for that period. It does not establish that the source is connected or that no security activity occurred.

The API reports a failed event-store query as an error, not as zero. Selectable event windows and the latest event timestamp use event occurrence time (`occurredAt`); source freshness uses server-side ingestion time (`createdAt`). Source cards separately show whether the receiver secret is configured, the latest received-record timestamp, and whether a record arrived in the last 15 minutes. Recent records prove only that records were stored recently; there is no sender heartbeat, so they do not prove continuous or current connectivity. A last received record older than 24 hours is labelled as an old record, not as a confirmed disconnection. Configuration presence does not prove that a sender or provider is connected.

The dashboard refreshes its admin-only event query every 30 seconds and displays the query generation time. If a refresh fails after an earlier successful response, the error is shown and the last successful result remains explicitly timestamped; a failed query is never converted into zero-valued statistics. The timeline, severity/source/action/type distributions, equal-length previous-window comparison, and priority list are database results for persisted events. Timeline buckets use `occurredAt`; the source cards separately use `createdAt`. The application producer counts are scoped to `source = APPLICATION`, rather than being inferred from similarly named event types from other sources.

Repeated-IP rows are a bounded investigation aid: they group non-null IPs with at least two persisted events in the selected occurrence-time window and expose the actual sources, event types, severity counts, and latest occurrence used. They do not identify an IP owner or prove malicious intent. The right-side priority list is a bounded set of persisted `CRITICAL`/`HIGH` records, not a confirmed-incident queue; this project has no incident-classification workflow. An event action of `DENIED`, `CHALLENGED`, or `BLOCKED` is reported as stored by its source and is not a measure of active firewall rules. In particular, `BLOCKED` does not prove a persistent BAGATI IP block.

Application event producers currently record only `LOGIN_FAILURE` and `RATE_LIMIT_VIOLATION` in the login endpoints that call `captureApplicationSecurityEvent`. Other event types in the shared schema are not thereby instrumented. The repeated-login indicator counts distinct non-null IPs with at least five persisted failed-login events in the most recent 15 minutes; when trusted client-IP collection is disabled, events without an IP are not part of that indicator. Application login failures and rate-limit denials do not include email addresses, passwords, request bodies, or authentication tokens.

`SUSPICIOUS_PATH`, `ABUSIVE_API`, and general `WAF_EVENT` have no in-application detector/producer currently wired. Apache ingestion can store actual `MODSECURITY_EVENT` records. The current `SecurityEvent` schema stores source, hashed source event ID, timestamp, source IP, sanitized path, event type, severity, action, and rule ID; it does not store ModSecurity messages, raw audit sections, or additional metadata. The UI therefore shows a rule ID only when present and does not fabricate a CRS message. `BLOCKED` is an event action, not proof of an active persistent IP block.

The event ingestion endpoints are:

- `POST /api/security/ingest/cloudflare`
- `POST /api/security/ingest/apache`

They accept one structured event per request, require an HMAC-SHA256 signature over `<unix-timestamp>.<exact-request-body>`, reject timestamps more than five minutes from server time, cap the body at 16 KiB, validate IPs and paths, reject arbitrary extra fields, and deduplicate by source plus event ID. Requests must include `x-bagati-timestamp` and `x-bagati-signature` headers. Raw access logs and ModSecurity audit bodies are intentionally not accepted.

The Cloudflare Security Events API adapter is not implemented. Merely configuring Cloudflare API credentials does not connect it. The Cloudflare ingestion endpoint is a signed-relay boundary, not a direct API integration; a persisted Cloudflare-labelled record confirms only a valid signed relay submission was stored, not independently verified Cloudflare visibility. IP control routes return an unavailable response until a server-side Cloudflare adapter is deliberately implemented; they do not claim to block traffic.

Apache/ModSecurity is not assumed to be connected. This repository includes an Ubuntu forwarding agent, but code presence or an externally observed audit-log warning does not prove that the agent reached this application or that a record was persisted. No dashboard end-to-end event is verified by this documentation. Check the dashboard's persisted source rows and coordinate an isolated staging event before claiming ingestion works.

## Server-only configuration

Configure these values only in the BAGATI server's protected environment or secret manager. Do not use `NEXT_PUBLIC_*`, commit values, print them in diagnostics, or expose them in client responses:

- `BAGATI_APACHE_INGEST_SECRET`: independent random secret of at least 32 bytes for the Ubuntu sender. Generate one with `openssl rand -hex 32`; configure it only in the server secret store. The empty `.env.example` entry is a name-only template, not a usable secret.
- `BAGATI_CLOUDFLARE_INGEST_SECRET`: independent random secret of at least 32 characters for a trusted Cloudflare Worker/relay, if one is built.
- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`: reserved for a future least-privilege Cloudflare API adapter. They do not activate any integration today.

Keep sender credentials separate; rotate them by coordinating the sender and server. Restrict ingress to HTTPS. Where possible, add network-level source restrictions without changing the existing Tunnel routing.

## Event payload and signature

Send only these fields: `eventId`, `occurredAt` (ISO timestamp with timezone), optional validated `sourceIp`, optional URL `path` without query or fragment, `eventType`, `severity`, `action`, and optional `ruleId`. Supported types and values are enforced by the application schema. Never include cookies, authorization headers, passwords, request bodies, query strings, raw ModSecurity audit records, or customer data.

For each request:

1. Serialize the exact JSON body as UTF-8.
2. Set `x-bagati-timestamp` to the current Unix timestamp in seconds.
3. Compute lowercase hexadecimal HMAC-SHA256 using the source-specific secret over `timestamp + "." + exactBody`.
4. Set the result in `x-bagati-signature`.
5. POST the body and headers over HTTPS to the source endpoint.

The event ID must be stable for a source event so retries are idempotent. BAGATI stores a source-scoped SHA-256 digest of this identifier rather than its original value.

## Connecting real Cloudflare data

1. Decide whether BAGATI will use a supported Cloudflare Security Events API/GraphQL query or a Logpush/Worker relay. Confirm account plan, access, event fields, retention, quotas, and API availability with Cloudflare.
2. Create a server-only API token restricted to the minimum read scopes needed for security events. For IP/rule management, use a separate token with only the narrowly required rule-edit scope and zone/account scope.
3. Implement and review the `CloudflareSecurityAdapter` in `lib/security-integrations.ts`; authenticate server-side, paginate, bound requests, normalize events, and never return credentials.
4. For Logpush, deploy a separately reviewed relay that removes sensitive fields and signs the normalized event payload using `BAGATI_CLOUDFLARE_INGEST_SECRET`. Direct Logpush delivery is not implemented by this project.
5. Verify in a Cloudflare test zone first: event delay, pagination/retries, duplicate IDs, API failure, rule expiration, and removal. Only then consider a controlled production integration.

No API token, relay, Security Events connection, or IP rule action is configured by this code change.

## Connecting Ubuntu Apache/ModSecurity

The repository includes `scripts/apache_modsec_agent.py`, a Python 3 standard-library-only tailing agent for a ModSecurity **serial audit log** at `/var/log/apache2/modsec_audit.log`. It emits only transactions whose H/K audit sections contain a real ModSecurity rule ID. It extracts the transaction timestamp, client IP, request path without query/fragment, rule ID, and any recorded severity. Raw audit sections, request/response headers and bodies, cookies, and query strings are never sent. A deny action is marked `BLOCKED` only when ModSecurity's audit message explicitly records “Access denied with code”; otherwise the action is `OBSERVED`. If no severity is recorded, the agent applies the documented conservative `MEDIUM` normalization.

The agent begins at the current end of the log when no cursor exists, so it does not import older log entries as new activity. Its private cursor stores a versioned byte offset, file identity, and a content guard immediately before the offset. A legacy cursor is upgraded at its existing offset, but its earlier history cannot be checked for copytruncate; confirm that rename/create rotation was used before relying on the upgraded cursor. The agent advances past an event only after the receiver accepts it or acknowledges it as a duplicate. On rename/create rotation, it drains the old inode to observed EOF and checks for growth again before moving on. When logrotate creates numbered archives (`.1`, `.2`, and so on), it processes intervening archives in order; after restart it locates the cursor's inode among uncompressed files named after the configured log. If that inode or an expected intermediate archive is missing, compressed, or changed, or rotation names are ambiguous, the agent stops rather than silently skipping unread data. Keep rotated files available and uncompressed until the agent has drained them. The tailer cannot prove that Apache has closed every writer handle to an old inode, so the server's rename/reopen procedure must be verified and must not continue appending to an old inode after the agent has moved past it. Network failures, HTTP 429, and HTTP 5xx receive bounded exponential retries. Event IDs are stable SHA-256 digests of ModSecurity transaction IDs; BAGATI additionally hashes them per source and enforces a PostgreSQL unique constraint. If the agent stops after a server write but before saving its cursor, the retry is acknowledged as a duplicate.

The parser expects a serial audit log with A, B, H or K, and Z sections. Use rename/create rotation only; `copytruncate` is unsupported because truncation followed by regrowth between polls cannot be detected with certainty and may irreversibly lose unread bytes. A detected shrink or changed content at the saved cursor makes the agent stop without resetting its cursor. No polling agent can prove that a same-inode truncate-and-regrow did not occur if the old cursor guard bytes are reproduced, so the operational prohibition on `copytruncate` is required for lossless operation. This integration does not enable audit logging or change `SecRuleEngine DetectionOnly`, audit parts, Apache configuration, WAF actions, or IP blocking. Confirm the existing log format, rename/create rotation policy, and permissions with the server administrator. Incomplete records are retained until complete. Oversized records are not forwarded; the agent pauses and preserves its cursor with a generic error rather than silently dropping a possible security event. The parser does not log record contents. Do not add request-body audit parts solely for this integration.

### Ubuntu installation and configuration

1. Complete the isolated staging steps in [Staging deployment](./staging-deployment.md) first. The `SecurityEvent` migration must exist in the target database before the receiver can persist events. Never point a test sender at production.
2. Install Python 3 and copy `scripts/apache_modsec_agent.py` to a root-owned location such as `/opt/bagati/apache_modsec_agent.py`. Create a dedicated non-login account such as `bagati-modsec`; grant it read access to the configured audit file (often via the existing `adm` group). Do not make the audit log world-readable.
3. Create `/etc/bagati` and `/var/lib/bagati-modsec`; make the latter writable only by `bagati-modsec`. Put the same independent value configured as BAGATI's `BAGATI_APACHE_INGEST_SECRET` into `/etc/bagati/apache-ingest.secret`. Set owner `root:bagati-modsec` and mode `0640` so the service account can read it through its private group, and ensure the value is not in a unit file, command-line argument, or shell history. The agent rejects group-writable and world-readable secret files.
4. Set `BAGATI_SECURITY_INGEST_URL=https://shopbagati.com/api/security/ingest/apache` in a protected systemd environment file. Use the separate verified HTTPS staging endpoint and a different secret for staging. The URL must not contain credentials, query strings, or fragments.
5. A reviewed systemd unit can use the following baseline, after adapting paths and verifying the `adm` log permission:

   ```ini
   [Unit]
   Description=BAGATI Apache ModSecurity security-event forwarder
   After=network-online.target
   Wants=network-online.target

   [Service]
   Type=simple
   User=bagati-modsec
   Group=bagati-modsec
   SupplementaryGroups=adm
   EnvironmentFile=/etc/bagati/apache-agent.env
   ExecStart=/usr/bin/python3 /opt/bagati/apache_modsec_agent.py
   Restart=on-failure
   RestartSec=10s
   NoNewPrivileges=true
   PrivateTmp=true
   ProtectSystem=strict
   ProtectHome=true
   ProtectKernelTunables=true
   ProtectKernelModules=true
   ProtectControlGroups=true
   ReadOnlyPaths=/var/log/apache2/modsec_audit.log
   ReadWritePaths=/var/lib/bagati-modsec

   [Install]
   WantedBy=multi-user.target
   ```

   Keep `/etc/bagati/apache-agent.env` limited to the non-secret `BAGATI_SECURITY_INGEST_URL` setting and restrict its file permissions. The ingest secret stays in its separate root-owned file. Give the service no database credentials and no permission to modify Apache/ModSecurity configuration. Review the effective unit and file permissions before starting it.
6. Validate only against isolated staging: check clock synchronization, TLS connectivity, HMAC acceptance, duplicate acknowledgement, persisted event visibility in `/admin/security-center`, and agent retry behavior. A `2xx` acknowledgement means an event was created or was a duplicate; it does not prove comprehensive or uninterrupted Apache monitoring.

Run parser/signature tests locally with `python -m unittest discover -s scripts -p "test_apache_modsec_agent.py"` and the existing API/schema tests with `npm run test:security-center`. Parser fixtures are synthetic test inputs only; the running agent has no demo-event mode and derives events exclusively from its configured audit log.

No Ubuntu host, Apache/ModSecurity log source, receiver connectivity, production secret, or production event storage is verified merely by adding this agent. Production use still requires secret provisioning, an approved application deployment, confirmation that the SecurityEvent migration is applied to the intended database, and a controlled end-to-end validation.

## Temporary IP controls

The current API includes admin-authenticated input validation and a provider-adapter boundary for listing, creating bounded temporary blocks, and removing a rule. It returns HTTP 503 while no adapter exists. The future adapter must enforce provider-side expiration, store the provider rule ID and expiry, audit the actor and decision, make retries idempotent, and reconcile expired/removed rules. Do not rely on an application timer alone to remove a security block.

## Database and rollout

The repository contains an additive `SecurityEvent` table migration. The currently running database and its migration status have not been verified by this implementation work. Before rollout, identify and confirm an isolated non-production database, review the SQL, take and verify an appropriate backup, apply it only to that intended database under the approved release process, and regenerate Prisma Client as part of the controlled build/deployment process. Do not treat the migration file's presence as proof that the table exists in any running database. Deploying the application without the migration means event writes and the Security Center API will not be available.

IP addresses and paths are sensitive operational data. Define an approved retention and access policy before production ingestion, restrict database and admin access, and periodically remove expired event records according to that policy.
