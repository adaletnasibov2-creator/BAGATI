import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  type ApplicationHistoryItem, applicantRateLimitBuckets, DEFAULT_SELLER_APPLICATION_LIMITS, reapplyDecision, reapplyRulesFrom,
  SELLER_APPLICATION_IP_RATE_LIMIT, SELLER_APPLICATION_RATE_LIMIT, SELLER_APPLICATION_RULES, sellerApplicationLimitTexts,
} from "../lib/seller-application";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const HOUR = 60 * 60 * 1000;
const now = new Date("2026-11-14T12:00:00.000Z");
const rejected = (createdHoursAgo: number, closedHoursAgo: number): ApplicationHistoryItem => ({
  status: "REJECTED", source: "SELF", createdAt: new Date(now.getTime() - createdHoursAgo * HOUR), reviewedAt: new Date(now.getTime() - closedHoursAgo * HOUR), withdrawnAt: null,
});

test("defaults keep today's behaviour exactly", () => {
  assert.deepEqual(DEFAULT_SELLER_APPLICATION_LIMITS, { reapplyWaitHours: 24, maxPer30Days: 3, perUserPerHour: 20, perIpPerHour: 60 });
  assert.deepEqual(reapplyRulesFrom(DEFAULT_SELLER_APPLICATION_LIMITS), { reapplyWaitMs: SELLER_APPLICATION_RULES.reapplyWaitMs, maxPerWindow: SELLER_APPLICATION_RULES.maxPerWindow, windowMs: SELLER_APPLICATION_RULES.windowMs });
  // The texts built from the defaults are word for word the texts that used to be hardcoded.
  assert.deepEqual(sellerApplicationLimitTexts(DEFAULT_SELLER_APPLICATION_LIMITS), {
    waitRule: "Rədd edilmiş və ya geri götürülmüş müraciətdən sonra 24 saat gözləmək lazımdır.",
    limitReached: "Son 30 gündə 3 müraciət göndərmisiniz.",
    withdrawConfirm: "Müraciəti geri götürsəniz, yeni müraciəti ən tezi 24 saat sonra göndərə bilərsiniz. Davam edilsin?",
  });
  const keyFor = (identity: string) => `k:${identity}`;
  assert.deepEqual(applicantRateLimitBuckets("u1", "203.0.113.1", keyFor), [
    { kind: "user", key: "k:user:u1", limit: SELLER_APPLICATION_RATE_LIMIT.limit, windowMs: SELLER_APPLICATION_RATE_LIMIT.windowMs },
    { kind: "ip", key: "k:ip:203.0.113.1", limit: SELLER_APPLICATION_IP_RATE_LIMIT.limit, windowMs: SELLER_APPLICATION_IP_RATE_LIMIT.windowMs },
  ]);
  // Same decision with and without explicit default rules.
  const history = [rejected(30, 23)];
  assert.deepEqual(reapplyDecision(history, now), reapplyDecision(history, now, reapplyRulesFrom(DEFAULT_SELLER_APPLICATION_LIMITS)));
});

test("injected limits change the decision, the buckets and the texts; the 30-day window stays fixed", () => {
  const limits = { reapplyWaitHours: 48, maxPer30Days: 1, perUserPerHour: 5, perIpPerHour: 10 };
  const rules = reapplyRulesFrom(limits);
  assert.equal(rules.windowMs, 30 * 24 * HOUR, "fixed in code");
  const waited = reapplyDecision([rejected(30, 25)], now, reapplyRulesFrom({ ...limits, maxPer30Days: 3 }));
  assert.equal(!waited.allowed && waited.reason, "WAIT", "48 h wait: 25 h is not enough");
  assert.deepEqual(reapplyDecision([rejected(30, 25)], now), { allowed: true }, "24 h default: allowed");
  const limited = reapplyDecision([rejected(80, 70)], now, rules);
  assert.equal(!limited.allowed && limited.reason, "LIMIT", "only 1 per 30 days");
  const buckets = applicantRateLimitBuckets("u1", "203.0.113.1", (identity) => identity, limits);
  assert.deepEqual(buckets.map((bucket) => bucket.limit), [5, 10]);
  assert.deepEqual(sellerApplicationLimitTexts(limits), {
    waitRule: "Rədd edilmiş və ya geri götürülmüş müraciətdən sonra 48 saat gözləmək lazımdır.",
    limitReached: "Son 30 gündə 1 müraciət göndərmisiniz.",
    withdrawConfirm: "Müraciəti geri götürsəniz, yeni müraciəti ən tezi 48 saat sonra göndərə bilərsiniz. Davam edilsin?",
  });
});

test("no page or component hardcodes the configurable numbers in its texts", () => {
  for (const path of ["app/vendor/apply/page.tsx", "components/vendor-apply-withdraw.tsx", "lib/seller-application.ts", "lib/seller-application-http.ts"]) {
    const source = read(path);
    assert.doesNotMatch(source, /\b24 saat|\b3 müraciət|\b20 sorğu|\b60 sorğu/, path);
  }
  const page = read("app/vendor/apply/page.tsx");
  assert.match(page, /const limits = await loadSellerApplicationLimits\(\);\s+const texts = sellerApplicationLimitTexts\(limits\);/);
  assert.match(page, /applicantState\(prisma, user\.id, new Date\(\), reapplyRulesFrom\(limits\)\)/);
  assert.match(page, /\{decision\.reason === "LIMIT" \? texts\.limitReached : texts\.waitRule\}/);
  const withdraw = read("components/vendor-apply-withdraw.tsx");
  assert.match(withdraw, /<p className="text-sm text-slate-700">\{confirmText\}<\/p>/);
  assert.doesNotMatch(withdraw, /@\/lib\/settings\//, "client component");
  assert.match(read("app/api/vendor/apply/route.ts"), /rules: reapplyRulesFrom\(guard\.limits\)/);
});

test("server loaders read the limit settings and fall back to the code constants", () => {
  const loaders = read("lib/settings/limits.ts");
  for (const key of ["sellerApplicationReapplyWaitHours", "sellerApplicationMaxPer30Days", "sellerApplicationPerUserPerHour", "sellerApplicationPerIpPerHour", "inquiryPerIpPerHour", "inquiryPerStorePerHour"]) {
    assert.match(loaders, new RegExp(`getSetting<number>\\(SETTING_KEYS\\.${key}\\)`), key);
  }
  assert.match(loaders, /perIpPerHour: perIpPerHour \?\? INQUIRY_IP_RATE_LIMIT\.limit/);
  assert.match(loaders, /perStorePerHour: perStorePerHour \?\? INQUIRY_STORE_RATE_LIMIT\.limit/);
  // Process-wide limits stay in code, not settings.
  assert.match(read("app/api/stores/[storeId]/inquiries/route.ts"), /consumeAuthProcessRateLimit\("store-inquiry", INQUIRY_PROCESS_RATE_LIMIT\.limit, INQUIRY_PROCESS_RATE_LIMIT\.windowMs\)/);
  assert.match(read("lib/seller-application-http.ts"), /consumeAuthProcessRateLimit\("seller-application", SELLER_APPLICATION_PROCESS_RATE_LIMIT\.limit, SELLER_APPLICATION_PROCESS_RATE_LIMIT\.windowMs\)/);
});
