import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { bakuLocalToIso, getSettingDefinition, isoToBakuLocal, SETTING_KEYS, type AnnouncementBar } from "../lib/settings/registry";
import { INQUIRY_IP_RATE_LIMIT, INQUIRY_STORE_RATE_LIMIT } from "../lib/store-inquiry";
import { SELLER_APPLICATION_IP_RATE_LIMIT, SELLER_APPLICATION_RATE_LIMIT, SELLER_APPLICATION_RULES } from "../lib/seller-application";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const definition = (key: string) => {
  const found = getSettingDefinition(key);
  assert.ok(found, key);
  return found!;
};

test("defaults equal today's behaviour: limits match the code constants", () => {
  assert.equal(definition(SETTING_KEYS.inquiryPerIpPerHour).default, INQUIRY_IP_RATE_LIMIT.limit);
  assert.equal(INQUIRY_IP_RATE_LIMIT.windowMs, 60 * 60 * 1000, "per hour");
  assert.equal(definition(SETTING_KEYS.inquiryPerStorePerHour).default, INQUIRY_STORE_RATE_LIMIT.limit);
  assert.equal(INQUIRY_STORE_RATE_LIMIT.windowMs, 60 * 60 * 1000);
  assert.equal(definition(SETTING_KEYS.sellerApplicationReapplyWaitHours).default, SELLER_APPLICATION_RULES.reapplyWaitMs / (60 * 60 * 1000));
  assert.equal(definition(SETTING_KEYS.sellerApplicationMaxPer30Days).default, SELLER_APPLICATION_RULES.maxPerWindow);
  assert.equal(SELLER_APPLICATION_RULES.windowMs, 30 * 24 * 60 * 60 * 1000, "the 30-day window stays fixed in code");
  assert.equal(definition(SETTING_KEYS.sellerApplicationPerUserPerHour).default, SELLER_APPLICATION_RATE_LIMIT.limit);
  assert.equal(definition(SETTING_KEYS.sellerApplicationPerIpPerHour).default, SELLER_APPLICATION_IP_RATE_LIMIT.limit);
  for (const key of [SETTING_KEYS.inquiryPerIpPerHour, SETTING_KEYS.inquiryPerStorePerHour, SETTING_KEYS.sellerApplicationReapplyWaitHours, SETTING_KEYS.sellerApplicationMaxPer30Days, SETTING_KEYS.sellerApplicationPerUserPerHour, SETTING_KEYS.sellerApplicationPerIpPerHour]) {
    assert.equal(definition(key).permission, "settings.limits", key);
    assert.equal(definition(key).sensitive, false, key);
  }
});

test("defaults equal today's behaviour: SEO texts match the current code; Open Graph is off; the bar is off", () => {
  const description = definition(SETTING_KEYS.seoDefaultDescription).default as string;
  assert.equal(description, "Azərbaycan mağazalarını və məhsullarını bir marketplace-də kəşf edin.");
  assert.ok(read("app/layout.tsx").includes(`description: "${description}"`), "same text as the hardcoded root description");
  const template = definition(SETTING_KEYS.seoStoreDescriptionTemplate).default as string;
  assert.equal(template, "Məhsulları {store} mağazasından BAGATI marketplace-də kəşf edin.");
  assert.ok(read("app/(customer)/stores/[storeId]/page.tsx").includes(`\`${template.replace("{store}", "${store.name}")}\``), "same text as the hardcoded store fallback");
  assert.equal(definition(SETTING_KEYS.seoDefaultOgTitle).default, null);
  assert.equal(definition(SETTING_KEYS.seoDefaultOgDescription).default, null);
  assert.deepEqual(definition(SETTING_KEYS.announcementBar).default, { enabled: false, text: "", href: null, tone: "info", startsAt: null, endsAt: null });
  for (const key of [SETTING_KEYS.seoDefaultDescription, SETTING_KEYS.seoDefaultOgTitle, SETTING_KEYS.seoDefaultOgDescription, SETTING_KEYS.seoStoreDescriptionTemplate, SETTING_KEYS.announcementBar]) {
    assert.equal(definition(key).permission, "settings.content", key);
    assert.equal(definition(key).sensitive, false, key);
    assert.equal(definition(key).read, "ttl", key);
  }
});

test("text settings: one line, trimmed, length-bounded; the store template needs exactly one {store}", () => {
  const description = definition(SETTING_KEYS.seoDefaultDescription);
  assert.deepEqual(description.inputSchema.safeParse("  Bakı və regionlardan mağazalar,\n məhsullar və kampaniyalar bir yerdə.  "), { success: true, data: "Bakı və regionlardan mağazalar, məhsullar və kampaniyalar bir yerdə." });
  assert.equal(description.inputSchema.safeParse("Qısa").success, false, "min 50");
  assert.equal(description.inputSchema.safeParse("x".repeat(301)).success, false, "max 300");
  assert.equal(description.schema.safeParse("multi\nline text that is long enough to pass the minimum length check").success, false, "stored value must be one line");
  const ogTitle = definition(SETTING_KEYS.seoDefaultOgTitle);
  assert.equal(ogTitle.inputSchema.safeParse("BAGATI").success, true);
  assert.equal(ogTitle.inputSchema.safeParse("   ").success, false, "empty: use reset (null = no Open Graph tag)");
  assert.equal(ogTitle.inputSchema.safeParse("x".repeat(121)).success, false);
  assert.equal(definition(SETTING_KEYS.seoDefaultOgDescription).inputSchema.safeParse("x".repeat(301)).success, false);
  const template = definition(SETTING_KEYS.seoStoreDescriptionTemplate);
  assert.equal(template.inputSchema.safeParse("{store} mağazasının məhsulları BAGATI-da").success, true);
  assert.equal(template.inputSchema.safeParse("Mağazanın məhsulları BAGATI-da satışdadır").success, false, "no placeholder");
  assert.equal(template.inputSchema.safeParse("{store} və {store} məhsulları BAGATI-da").success, false, "twice");
});

test("integer limits: whole numbers inside the bounds only", () => {
  const perIp = definition(SETTING_KEYS.inquiryPerIpPerHour);
  assert.deepEqual(perIp.inputSchema.safeParse("1"), { success: true, data: 1 });
  assert.deepEqual(perIp.inputSchema.safeParse(50), { success: true, data: 50 });
  for (const bad of ["0", "51", "2.5", "-1", "abc", "", "1e1"]) assert.equal(perIp.inputSchema.safeParse(bad).success, false, bad);
  assert.equal(perIp.schema.safeParse(2.5).success, false);
  const bounds = (key: string) => { const input = definition(key).input; return input.kind === "integer" ? [input.min, input.max] : null; };
  assert.deepEqual(bounds(SETTING_KEYS.inquiryPerStorePerHour), [5, 500]);
  assert.deepEqual(bounds(SETTING_KEYS.sellerApplicationReapplyWaitHours), [1, 168]);
  assert.deepEqual(bounds(SETTING_KEYS.sellerApplicationMaxPer30Days), [1, 10]);
  assert.deepEqual(bounds(SETTING_KEYS.sellerApplicationPerUserPerHour), [5, 100]);
  assert.deepEqual(bounds(SETTING_KEYS.sellerApplicationPerIpPerHour), [10, 500]);
  assert.equal(definition(SETTING_KEYS.sellerApplicationReapplyWaitHours).display(24), "24 saat");
});

test("announcement bar: plain one-line text up to 200, safe link, tone, Baku times converted, end after start", () => {
  const bar = definition(SETTING_KEYS.announcementBar);
  const form = { enabled: true, text: "  Bayram endirimləri  başladı!  ", href: "/products", tone: "success", startsAt: "2026-12-01T09:00", endsAt: "2026-12-10T23:30" };
  const parsed = bar.inputSchema.safeParse(form);
  assert.equal(parsed.success, true);
  const value = parsed.data as AnnouncementBar;
  assert.equal(value.text, "Bayram endirimləri başladı!");
  assert.equal(value.startsAt, "2026-12-01T05:00:00.000Z", "Baku is UTC+4");
  assert.equal(value.endsAt, "2026-12-10T19:30:00.000Z");
  assert.equal(bar.schema.safeParse(value).success, true);
  assert.deepEqual(bar.toForm!(value), { enabled: true, text: "Bayram endirimləri başladı!", href: "/products", tone: "success", startsAt: "2026-12-01T09:00", endsAt: "2026-12-10T23:30" });
  const bad = (patch: Record<string, unknown>) => bar.inputSchema.safeParse({ ...form, ...patch }).success;
  assert.equal(bad({ text: "" }), false, "enabled needs text");
  assert.equal(bad({ enabled: false, text: "" }), true, "disabled may be empty");
  assert.equal(bad({ text: "x".repeat(201) }), false);
  for (const href of ["javascript:alert(1)", "//evil.example", "http://example.com", "https://user:pw@example.com", "/a\\b", "/tab\there"]) assert.equal(bad({ href }), false, href);
  assert.equal(bad({ href: "https://shopbagati.com/kampaniya" }), true);
  assert.equal(bad({ href: "" }), true, "no link");
  assert.equal(bad({ tone: "purple" }), false);
  assert.equal(bad({ endsAt: "2026-12-01T09:00" }), false, "end must be after start");
  assert.equal(bad({ startsAt: "1 dekabr" }), false);
  assert.equal(bar.schema.safeParse({ ...value, extra: 1 }).success, false, "no unknown fields");
  assert.equal(bar.schema.safeParse({ ...value, text: "line\nbreak" }).success, false);
  assert.equal(bakuLocalToIso(""), null);
  assert.equal(bakuLocalToIso("2026-13-40T99:99"), undefined);
  assert.equal(isoToBakuLocal(null), "");
  assert.match(bar.display(value), /^Aktiv \(Uğur\): Bayram endirimləri başladı!$/);
  assert.equal(bar.display(null), "Söndürülüb");
});
