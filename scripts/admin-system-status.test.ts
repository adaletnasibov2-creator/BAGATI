import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  SYSTEM_STATUS_CACHE_TTL_MS,
  SYSTEM_STATUS_MIN_REFRESH_MS,
  bakuStartOfDay,
  createTtlCache,
  maskIpAddress,
  missingMigrations,
  parseSystemStatusCard,
  postgresMajorVersion,
} from "../lib/admin-system-status";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

test("system status page and API require the ADMIN role", () => {
  const page = read("app/admin/system/page.tsx");
  assert.match(page, /const admin = await requireRole\("ADMIN"\);\s*if \(!admin\) redirect\("\/admin\/login"\)/);
  const api = read("app/api/admin/system/route.ts");
  assert.match(api, /export async function GET[\s\S]*?const admin = await requireRole\("ADMIN"\);\s*if \(!admin\) return NextResponse\.json\(\{ error: "İcazə yoxdur" \}, \{ status: 403/);
  assert.doesNotMatch(api, /export async function (POST|PUT|PATCH|DELETE)/, "status API is read-only");
});

test("system status is linked from the admin menu", () => {
  assert.match(read("components/admin-shell.tsx"), /\["\/admin\/system", "Sistem vəziyyəti", Activity\]/);
});

test("system status never exposes secret values or personal data", () => {
  const cards = read("lib/admin-system-status-cards.ts");
  // Only booleans/modes leave the server for configuration.
  assert.doesNotMatch(cards, /process\.env\.(SMTP_|EMAIL_ENCRYPTION_KEY|SESSION_SECRET|DATABASE_URL|GOOGLE_|S3_)/);
  assert.doesNotMatch(cards, /"email"|\."email"|contactEmail|contactPhone|"recipient"|"payload"/);
  assert.match(cards, /maskIpAddress\(row\.sourceIp\)/);
  // Every card's queries run in a read-only transaction with a statement timeout.
  assert.match(cards, /SET TRANSACTION READ ONLY/);
  assert.match(cards, /SET LOCAL statement_timeout/);
  const component = read("components/admin-system-status.tsx");
  assert.doesNotMatch(component, /setInterval|setTimeout/, "no auto-polling");
  assert.match(component, /Yenilə/);
});

test("/api/ready and the status page share one readiness implementation", () => {
  assert.match(read("app/api/ready/route.ts"), /collectReadinessDetails\(prisma\)/);
  assert.match(read("lib/admin-system-status-cards.ts"), /collectReadinessDetails\(tx\)/);
});

test("card names are validated", () => {
  assert.equal(parseSystemStatusCard("database"), "database");
  assert.equal(parseSystemStatusCard("application"), "application");
  assert.equal(parseSystemStatusCard("users"), null);
  assert.equal(parseSystemStatusCard(undefined), null);
  assert.equal(parseSystemStatusCard("__proto__"), null);
});

test("Baku day starts at 20:00 UTC of the previous day", () => {
  assert.equal(bakuStartOfDay(new Date("2026-11-13T10:00:00Z")).toISOString(), "2026-11-12T20:00:00.000Z");
  assert.equal(bakuStartOfDay(new Date("2026-11-13T19:59:59Z")).toISOString(), "2026-11-12T20:00:00.000Z");
  assert.equal(bakuStartOfDay(new Date("2026-11-13T20:00:00Z")).toISOString(), "2026-11-13T20:00:00.000Z");
});

test("IP addresses are masked", () => {
  assert.equal(maskIpAddress("203.0.113.45"), "203.0.*.*");
  assert.equal(maskIpAddress("2001:db8:85a3::8a2e:370:7334"), "2001:db8:*:*");
  assert.equal(maskIpAddress("not-an-ip"), "***");
  assert.equal(maskIpAddress(null), "***");
});

test("missing migrations are folders not recorded as applied", () => {
  const folders = ["20261113010000_store_inquiries", "20261112010000_x", "migration_lock.toml", "notes"];
  assert.deepEqual(missingMigrations(folders, ["20261112010000_x"]), ["20261113010000_store_inquiries"]);
  assert.deepEqual(missingMigrations(folders, ["20261112010000_x", "20261113010000_store_inquiries"]), []);
});

test("PostgreSQL major version comes from server_version_num", () => {
  assert.equal(postgresMajorVersion("160004"), 16);
  assert.equal(postgresMajorVersion("170002"), 17);
  assert.equal(postgresMajorVersion("x"), null);
});

test("cache reuses results for the TTL; manual refresh only after the minimum interval; failures are not cached", async () => {
  let now = 0;
  let loads = 0;
  const cache = createTtlCache<number>(SYSTEM_STATUS_CACHE_TTL_MS, SYSTEM_STATUS_MIN_REFRESH_MS, () => now);
  const load = async () => ++loads;
  assert.equal(await cache.get("k", load), 1);
  now = SYSTEM_STATUS_CACHE_TTL_MS - 1;
  assert.equal(await cache.get("k", load), 1, "served from cache inside TTL");
  now = SYSTEM_STATUS_CACHE_TTL_MS + 1;
  assert.equal(await cache.get("k", load), 2, "reloaded after TTL");
  now += SYSTEM_STATUS_MIN_REFRESH_MS - 1;
  assert.equal(await cache.get("k", load, { refresh: true }), 2, "refresh inside minimum interval reuses result");
  now += 2;
  assert.equal(await cache.get("k", load, { refresh: true }), 3, "refresh after minimum interval reloads");

  await assert.rejects(cache.get("bad", async () => { throw new Error("boom"); }));
  await new Promise((done) => setImmediate(done));
  assert.equal(await cache.get("bad", async () => 7), 7, "a failure is evicted immediately");
});

test("raw SQL date bounds are converted to UTC wall-clock time (regression: 4h shift under TimeZone=Asia/Baku)", async () => {
  const { utcTimestamp } = await import("../lib/sql-timestamp");
  const fragment = utcTimestamp(new Date("2026-11-13T00:00:00Z"));
  assert.equal(fragment.text, "($1::timestamptz AT TIME ZONE 'UTC')");
  assert.deepEqual(fragment.values, [new Date("2026-11-13T00:00:00Z")]);
  // Every comparison against a timestamp column in these raw queries must go through utcTimestamp().
  for (const path of ["lib/admin-system-status-cards.ts", "lib/admin-audit-log-query.ts"]) {
    const source = read(path);
    assert.doesNotMatch(source, /(>=|<=|<|>) \$\{(?!utcTimestamp\()/, path);
    assert.match(source, /utcTimestamp\(/, path);
  }
});
