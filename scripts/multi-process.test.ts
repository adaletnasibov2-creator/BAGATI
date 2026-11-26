/**
 * MULTI-PROCESS-1: the app may run as several processes (scripts/cluster-start.mjs, BAGATI_WORKERS). These pins keep
 * that safe (release-output/multi-process-audit-1-report.md):
 * (a) worker count rules; (b) inventory of every per-process state holder: a new one fails here until someone decides
 * it is safe with N processes and adds it with a reason; (c) password / code / payment / order paths are limited in the
 * database, not per process; (d) one email sender (advisory lock) + compare-and-set claim; (e) order expiry row lock;
 * (f) maintenance ON/OFF read uncached; (g) cluster-start.mjs safety parts.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createRestartLimiter, MAX_WORKERS, resolveWorkerCount, restartDelayMs, RESTART_LIMIT, STOP_TIMEOUT_MS } from "./cluster-workers.mjs";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const walk = (dir: string): string[] => readdirSync(join(root, dir)).flatMap((name) => {
  const path = `${dir}/${name}`;
  return statSync(join(root, path)).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
});
const SOURCES = [...walk("lib"), ...walk("app")].sort();

// ---------------------------------------------------------------------------------------------------------------
// (a) worker count
// ---------------------------------------------------------------------------------------------------------------

test("(a) BAGATI_WORKERS: default 1; empty, invalid or < 1 -> 1; capped at min(4, CPUs)", () => {
  assert.equal(MAX_WORKERS, 4);
  for (const raw of [undefined, "", "  ", "0", "-2", "abc", "2.5", "1e3", "2 workers", "0x2"]) assert.equal(resolveWorkerCount(raw, 4), 1, String(raw));
  assert.equal(resolveWorkerCount("1", 4), 1);
  assert.equal(resolveWorkerCount("2", 4), 2);
  assert.equal(resolveWorkerCount(" 3 ", 4), 3);
  assert.equal(resolveWorkerCount("4", 4), 4);
  assert.equal(resolveWorkerCount("8", 4), 4, "never more than 4");
  assert.equal(resolveWorkerCount("999", 16), 4, "never more than 4, even with more CPUs");
  assert.equal(resolveWorkerCount("3", 2), 2, "never more than the CPUs");
  assert.equal(resolveWorkerCount("3", 0), 1, "unknown CPUs -> 1");
  assert.equal(resolveWorkerCount("3", Number.NaN), 1);
});

test("(a) restart budget: 5 per 60 s, then refused; frees up as the window moves; delay 1-5 s", () => {
  assert.deepEqual(RESTART_LIMIT, { max: 5, windowMs: 60_000 });
  const limiter = createRestartLimiter();
  for (let i = 0; i < 5; i += 1) assert.equal(limiter.allow(1_000 + i), true, `restart ${i + 1}`);
  assert.equal(limiter.allow(2_000), false, "6th within 60 s");
  assert.equal(limiter.recent(2_000), 5);
  assert.equal(limiter.allow(61_000), true, "the first one left the window");
  assert.deepEqual([0, 1, 2, 5, 9].map(restartDelayMs), [1_000, 1_000, 2_000, 5_000, 5_000]);
  assert.equal(STOP_TIMEOUT_MS, 15_000);
});

// ---------------------------------------------------------------------------------------------------------------
// (b) inventory of per-process state
// ---------------------------------------------------------------------------------------------------------------

/** Every module-level state holder in lib/ and app/, with why it is fine with several processes. */
const APPROVED: Record<string, string> = {
  // Constant lookups (never written after load): identical in every process.
  "app/admin/page.tsx#ATTENTION_HREFS": "constant",
  "app/api/auth/google/callback/route.ts#REGISTER_RESULTS": "constant",
  "lib/admin-audit-log.ts#SENSITIVE_EXACT": "constant",
  "lib/auth-logging.ts#prismaCodes": "constant",
  "lib/az-phone.ts#MOBILE_CODES": "constant",
  "lib/csrf.ts#LOCAL_HOSTNAMES": "constant",
  "lib/csrf.ts#SAFE_METHODS": "constant",
  "lib/edge-cache.ts#EXACT_PATHS": "constant",
  "lib/email-outbox-core.ts#AMBIGUOUS_CONN_CODES": "constant",
  "lib/email-outbox-core.ts#BEFORE_DATA_COMMANDS": "constant",
  "lib/email-outbox-core.ts#CONNECT_COMMANDS": "constant",
  "lib/email-outbox-core.ts#MESSAGE_REJECTION_CODES": "constant",
  "lib/email-outbox-core.ts#PERMANENT_TLS_CODES": "constant",
  "lib/email-outbox-worker.ts#AGE_LIMITED_TEMPLATES": "constant",
  "lib/email-outbox-worker.ts#DIAGNOSTIC_FIELD_NAMES": "constant",
  "lib/email-worker-monitoring.ts#databaseConnectionFailureCodes": "constant",
  "lib/email-worker-monitoring.ts#errorTypes": "constant",
  "lib/google-oauth.ts#CUSTOMER_ALLOWED_VENDOR_PATHS": "constant",
  "lib/google-oauth.ts#LOCAL_OAUTH_HOSTS": "constant",
  "lib/google-oauth.ts#LOCAL_TEST_HOSTNAMES": "constant",
  "lib/maintenance.ts#EXACT": "constant",
  "lib/payments/epoint-protocol.ts#CURRENCIES": "constant",
  "lib/payments/epoint-protocol.ts#PROVIDER_STATUSES": "constant",
  "lib/security-logging.ts#prismaCodes": "constant",
  "lib/settings/registry.ts#byKey": "constant",
  "lib/static-asset-paths.ts#STATIC_FILES": "constant",
  "lib/vendor-finance.ts#OPEN_EXCLUDED": "constant",
  "lib/vendor-order-view.ts#DESTRUCTIVE": "constant",
  // In-process limits: flood caps only, N times looser with N processes (audit 1a). Real limits are in the database.
  "lib/auth-rate-limit.ts#processBuckets": "flood caps (consumeAuthProcessRateLimit)",
  "lib/payments/epoint-rate-limit.ts#buckets": "Epoint flood caps",
  // Per-process caches: other processes catch up within their TTL (audit 1b).
  "lib/site-settings.ts#loader": "30 s cache",
  "lib/settings/read.ts#loader": "30 s cache (maintenance ON/OFF is read uncached, see (f))",
  "lib/settings/read.ts#invalidLoggedAt": "log de-dupe",
  "lib/admin-system-status-cards.ts#cache": "15 s admin cache",
  "lib/admin-audit-log-query.ts#distinctCache": "60 s dropdown values",
  "lib/maintenance-preview.ts#cache": "10 s admin preview check",
  "lib/maintenance-state.ts#cached": "middleware 10 s / 1 s cache of /api/maintenance-state",
  "lib/maintenance-state.ts#inFlight": "request coalescing",
  "lib/maintenance-state.ts#lastCheck": "per-process admin diagnostic",
  "lib/maintenance-state.ts#lastWarningAt": "log de-dupe",
  "lib/maintenance-origin.ts#warnedFor": "log de-dupe",
  "lib/google-oauth.ts#cachedJwks": "Google key cache",
  "lib/google-oauth.ts#reportedConfigIssues": "log de-dupe",
  "lib/email.ts#smtpTrustedCertificates": "config read once",
  "lib/login-timing.ts#dummyHash": "constant-time dummy hash",
  "lib/security-events.ts#lastMismatchEventAt": "event de-dupe: up to N events per minute",
  // Single use inside one process; the completion handler's database re-check blocks a second use across processes.
  "lib/google-pending-signup.ts#usedPendingSignups": "plus database re-check",
  // Upload concurrency: 3 per process (3 x N in total).
  "lib/storage/store-assets.ts#activeUploads": "per-process upload slots",
  "lib/storage/store-assets.ts#uploadWaiters": "per-process upload queue",
  "lib/storage/store-assets.ts#cachedS3Storage": "client object",
  // globalThis holders (one per process; survive duplicated bundles).
  "lib/active-cities.ts#globalThis": "30 s cache",
  "lib/home-page-data.ts#globalThis": "30 s cache",
  "lib/public-category-tree.ts#globalThis": "30 s cache",
  "lib/sitemap.ts#globalThis": "1 h cache",
  "lib/prisma.ts#globalThis": "one pool per process (connection_limit each)",
  "lib/email-worker-runtime.ts#globalThis": "worker loop; one sender across processes via advisory lock (d)",
  "lib/order-expiry-runtime.ts#globalThis": "expiry loop; row lock per order (e)",
  "lib/security-monitoring/instance.ts#globalThis": "telemetry buffer; counters are added in SQL",
  "lib/security-monitoring/jobs.ts#globalThis": "job throttle; rules/maintenance take advisory locks",
};

const declared = (source: string, pattern: RegExp) => [...source.matchAll(pattern)].map((match) => match[1]);

function inventory(): string[] {
  const found: string[] = [];
  for (const path of SOURCES) {
    const source = read(path);
    for (const name of declared(source, /^(?:export )?(?:const|let) ([A-Za-z0-9_$]+)(?::[^=\n]+)?\s*=\s*new (?:Map|Set)\b/gm)) found.push(`${path}#${name}`);
    for (const name of declared(source, /^(?:export )?let ([A-Za-z0-9_$]+)/gm)) found.push(`${path}#${name}`);
    for (const name of declared(source, /^(?:export )?const ([A-Za-z0-9_$]+)(?::[^=\n]+)?\s*=\s*(?:createFailSafeLoader|createTtlCache|createKeyedTtlCache)\b/gm)) found.push(`${path}#${name}`);
    for (const name of declared(source, /^(?:export )?const ([A-Za-z0-9_$]+)\s*:\s*Array<[^\n]*>\s*=\s*\[\]/gm)) found.push(`${path}#${name}`);
    if (/globalThis as |globalThis\.__|globalThis\[/.test(source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n"))) found.push(`${path}#globalThis`);
  }
  return [...new Set(found)].sort();
}

test("(b) every module-level state holder in lib/ and app/ is approved for several processes", () => {
  const found = inventory();
  const unapproved = found.filter((key) => !(key in APPROVED));
  assert.deepEqual(unapproved, [], "new per-process state: decide whether it is safe with N processes, then add it to APPROVED with a reason");
  const gone = Object.keys(APPROVED).filter((key) => !found.includes(key));
  assert.deepEqual(gone, [], "approved entry no longer exists: remove it from APPROVED");
});

/** Files that call an in-process limiter, and how many calls (audit 1a: flood caps only). */
const PROCESS_LIMITER_CALLS: Record<string, number> = {
  "app/api/auth/google/callback/route.ts": 1,
  "app/api/auth/google/complete-register/route.ts": 1,
  "app/api/auth/google/start/route.ts": 1,
  "app/api/auth/register/route.ts": 1,
  "app/api/payments/epoint/callback/route.ts": 2,
  "app/api/payments/epoint/initiate/route.ts": 1,
  "app/api/store-notification-email/verify/route.ts": 2,
  "app/api/stores/[storeId]/inquiries/route.ts": 1,
  "lib/seller-application-http.ts": 1,
};

/** Callers of the two in-process wrappers (public search 120/min per IP; admin search / export). */
const WRAPPER_CALLS: Record<string, number> = {
  "app/(customer)/products/(list)/page.tsx": 1,
  "app/(customer)/stores/page.tsx": 1,
  "app/api/products/cursor/route.ts": 1,
  "app/api/products/route.ts": 1,
  "app/api/store-options/route.ts": 1,
  "app/api/stores/cursor/route.ts": 1,
  "app/api/admin/list-export/[list]/route.ts": 1,
  "app/api/admin/search/route.ts": 1,
  // ADMIN-3-EXPORTS-1: the products CSV and the sales report CSV share the admin export flood cap (per admin and IP;
  // N processes = N x the budget, acceptable for an admin-only, audited export).
  "app/api/admin/products/export/route.ts": 1,
  "app/api/admin/reports/route.ts": 1,
};

const countCalls = (pattern: RegExp, skip: string[]) => {
  const found: Record<string, number> = {};
  for (const path of SOURCES) {
    if (skip.includes(path)) continue;
    const count = (read(path).match(pattern) ?? []).length;
    if (count) found[path] = count;
  }
  return found;
};

test("(b) in-process limiter call sites are exactly the approved flood caps", () => {
  assert.deepEqual(countCalls(/\b(?:consumeAuthProcessRateLimit|consumePaymentRateLimit)\(/g, ["lib/auth-rate-limit.ts", "lib/payments/epoint-rate-limit.ts"]), PROCESS_LIMITER_CALLS);
  assert.deepEqual(countCalls(/\b(?:allowPublicSearch|allowAdminRequest)\(/g, ["lib/public-search-rate-limit.ts", "lib/admin-request-limit.ts"]), WRAPPER_CALLS);
  // The wrappers default to the in-process limiter and nothing else.
  assert.match(read("lib/public-search-rate-limit.ts"), /consume: ProcessLimiter = consumeAuthProcessRateLimit/);
  assert.match(read("lib/admin-request-limit.ts"), /consume: ProcessLimiter = consumeAuthProcessRateLimit/);
});

// ---------------------------------------------------------------------------------------------------------------
// (c) sensitive paths are limited in the database
// ---------------------------------------------------------------------------------------------------------------

test("(c) password, code, payment and order paths use the database limiter, never only the in-process one", () => {
  const databaseLimited = [
    "app/api/auth/login/route.ts", "app/api/auth/vendor-login/route.ts", "app/api/admin/login/route.ts",
    "app/api/auth/forgot-password/route.ts", "app/api/auth/reset-password/route.ts", "app/api/account/security/password/route.ts",
    "lib/admin-2fa.ts", "app/api/auth/google/link/route.ts",
    "app/api/orders/route.ts", "app/api/orders/[orderId]/store-orders/[storeOrderId]/receipt/route.ts",
    "app/api/payments/epoint/reconcile/route.ts", "app/api/support/route.ts", "app/api/vendor/[storeId]/notification-email/route.ts",
    "lib/messaging-service.ts", "lib/shipment-email-guard.ts", "lib/admin-email-action-runtime.ts",
  ];
  for (const path of databaseLimited) {
    const source = read(path);
    assert.match(source, /consumeAuthRateLimit\(|withinFormRateLimits\(/, `${path}: database limiter`);
    assert.doesNotMatch(source, /consumeAuthProcessRateLimit\(|consumePaymentRateLimit\(/, `${path}: no in-process limiter`);
  }
  // Order creation: per account and per IP, in the database.
  assert.match(read("app/api/orders/route.ts"), /ORDER_CREATE_RATE_LIMIT/);
  assert.match(read("app/api/orders/route.ts"), /ORDER_CREATE_IP_RATE_LIMIT/);
  // The database limiter itself: one atomic upsert in AuthRateLimit.
  assert.match(read("lib/auth-rate-limit.ts"), /INSERT INTO "AuthRateLimit"[\s\S]*ON CONFLICT \("keyHash"\) DO UPDATE/);
});

// ---------------------------------------------------------------------------------------------------------------
// (d) (e) background work
// ---------------------------------------------------------------------------------------------------------------

test("(d) email outbox: one sender across processes (advisory lock) and a compare-and-set claim per row", () => {
  const runtime = read("lib/email-worker-runtime.ts");
  assert.match(runtime, /export const EMAIL_OUTBOX_LOCK_KEY = "72411202611180001";/);
  assert.match(runtime, /pg_try_advisory_lock\(CAST\(\$\{key\} AS bigint\)\)/);
  assert.match(runtime, /pg_advisory_unlock\(CAST\(\$\{key\} AS bigint\)\)/);
  const worker = read("lib/email-outbox-worker.ts");
  assert.match(worker, /const claimed = await updateOutboxRows\(database, \{ id: candidate\.id, status: "PENDING" \}, \{\n\s*status: "PROCESSING",/);
  assert.match(worker, /if \(claimed\.count !== 1\) continue;/);
});

test("(e) order expiry: each order under FOR UPDATE SKIP LOCKED", () => {
  assert.match(read("lib/order-expiry.ts"), /SELECT "id" FROM "Order" WHERE "id" = \$\{input\.orderId\} FOR UPDATE SKIP LOCKED/);
  assert.match(read("lib/security-monitoring/jobs.ts"), /pg_advisory_xact_lock\(hashtext\(/);
  assert.match(read("lib/security-monitoring/jobs.ts"), /pg_try_advisory_xact_lock\(hashtext\('bagati-security-maintenance'\)\)/);
});

// ---------------------------------------------------------------------------------------------------------------
// (f) maintenance switch
// ---------------------------------------------------------------------------------------------------------------

test("(f) /api/maintenance-state reads the ON/OFF flag uncached, falls back to the cached read, same response", () => {
  const route = read("app/api/maintenance-state/route.ts");
  assert.match(route, /return await readSettingInTransaction<boolean>\(prisma, SETTING_KEYS\.maintenanceEnabled\);\n\s*\} catch \{\n\s*return getSetting<boolean>\(SETTING_KEYS\.maintenanceEnabled\);/);
  assert.doesNotMatch(route.slice(0, route.indexOf("async function readMaintenanceEnabledUncached")), /getSetting<boolean>\(SETTING_KEYS\.maintenanceEnabled\)/, "GET does not read the flag from the cache directly");
  assert.match(route, /NextResponse\.json\(\{ enabled: enabled === true, message: message \|\| MAINTENANCE_MESSAGE_DEFAULT \}, \{ headers: \{ "Cache-Control": "no-store" \} \}\)/);
  assert.match(read("lib/settings/read.ts"), /tx\.siteSetting\.findUnique\(\{ where: \{ key \}, select: \{ value: true \} \}\)/, "one primary-key read");
});

// ---------------------------------------------------------------------------------------------------------------
// (g) cluster-start.mjs
// ---------------------------------------------------------------------------------------------------------------

test("(g) cluster-start.mjs: 1 worker = next start in this process; forwards signals; restart limit; no new packages", () => {
  const script = read("scripts/cluster-start.mjs");
  const imports = [...script.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]).sort();
  assert.deepEqual(imports, ["./cluster-workers.mjs", "node:cluster", "node:module", "node:os"]);
  assert.match(script, /const workers = resolveWorkerCount\(process\.env\.BAGATI_WORKERS, availableParallelism\(\)\);/);
  assert.match(script, /\} else if \(workers === 1\) \{\n\s*startNextServer\(\);/, "1 worker: no cluster, no fork");
  assert.match(script, /require\.resolve\("next\/dist\/bin\/next"\)/);
  assert.match(script, /process\.argv = \[process\.argv\[0\], bin, "start", \.\.\.process\.argv\.slice\(2\)\];/);
  assert.match(script, /for \(const signal of \["SIGTERM", "SIGINT"\]\) process\.on\(signal, \(\) => stopAll\(signal, 0\)\);/);
  assert.match(script, /worker\?\.process\.kill\(signal\)/, "signals are forwarded to every worker");
  assert.match(script, /worker\?\.process\.kill\("SIGKILL"\)/, "stragglers are killed after the timeout");
  assert.match(script, /if \(!limiter\.allow\(now\)\) \{\n[\s\S]*?stopAll\("SIGTERM", 1\);/, "crash loop: stop and exit 1");
  assert.match(script, /cluster\.fork\(\{ \[WORKER_ENV\]: String\(slot\) \}\)/);
  assert.match(script, /log\("cluster_worker_start", \{ worker: slot, pid: worker\.process\.pid \}\)/);
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts.start, "next start", "plain start unchanged");
  assert.equal(pkg.scripts["start:cluster"], "node scripts/cluster-start.mjs");
  // db_pool line carries pid + worker; the worker id comes from the env the primary sets.
  assert.match(read("lib/db-pool-info.ts"), /for \(const raw of \[env\.BAGATI_CLUSTER_WORKER_ID, env\.NODE_APP_INSTANCE\]\)/);
});
