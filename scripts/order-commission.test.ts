import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
/** Text of the balanced (...) that starts at `open`. */
function balanced(text: string, open: number): string {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    else if (text[index] === ")" && --depth === 0) return text.slice(open, index + 1);
  }
  return text.slice(open);
}

function files(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    return statSync(join(root, path)).isDirectory() ? files(path) : /\.(ts|tsx|mjs|cjs|js|sql)$/.test(name) ? [relative(".", path).replace(/\\/g, "/")] : [];
  });
}

test("only order creation writes StoreOrder.commissionRateSnapshot; nothing updates or backfills it", () => {
  const scanned = [...files("app"), ...files("lib"), ...files("components"), ...files("prisma"), ...files("scripts")]
    .filter((file) => !/\.test\.(ts|mjs)$|\.integration\.test\.ts$/.test(file));
  assert.ok(scanned.length > 100);
  const writers: string[] = [];
  for (const file of scanned) {
    const text = read(file);
    // Every Prisma write of an Order (nested storeOrders) or a StoreOrder; inside it, any value other than `true` (a select).
    for (const call of text.matchAll(/\b(?:order|storeOrder)\.(?:create|createMany|update|updateMany|upsert)\s*\(/g)) {
      const body = balanced(text, text.indexOf("(", call.index));
      for (const match of body.matchAll(/commissionRateSnapshot\s*:\s*(?!true\b)([^,}\s][^,}]*)/g)) writers.push(`${file}: ${match[1].trim().slice(0, 60)}`);
    }
    if (/SET[\s\S]{0,200}?"commissionRateSnapshot"\s*=/i.test(text)) writers.push(`${file}: SQL SET`);
  }
  assert.deepEqual(writers, ["app/api/orders/route.ts: commissionRates.get(group.storeId)??null"]);
  const migrations = files("prisma/migrations").filter((file) => /commissionRateSnapshot/.test(read(file)));
  assert.deepEqual(migrations, ["prisma/migrations/20261106010000_store_order_commission_rate_snapshot/migration.sql"], "only the migration that added the column");
});

test("the order route reads the commission inside its transaction through commissionRatesForNewOrder", () => {
  const route = read("app/api/orders/route.ts");
  const transaction = route.indexOf("$transaction(");
  const rates = route.indexOf("const commissionRates = await commissionRatesForNewOrder(tx, storeOrders.map((group:any)=>group.storeId), orderCreatedAt);");
  const create = route.indexOf("commissionRateSnapshot:commissionRates.get(group.storeId)??null");
  assert.ok(transaction > 0 && rates > transaction && create > rates);
  assert.doesNotMatch(route, /getSetting\(/, "never the cached read");
  const helper = read("lib/order-commission.ts");
  assert.match(helper, /readSettingInTransaction<string>\(tx, SETTING_KEYS\.commissionDefaultRate\)/);
  assert.match(helper, /storeRate\.get\(storeId\) \?\? fallback/);
  assert.match(helper, /where: \{ storeId: \{ in: storeIds \}, startsAt: \{ lte: at \}, OR: \[\{ endsAt: null \}, \{ endsAt: \{ gt: at \} \}\] \}/);
  assert.match(helper, /orderBy: \{ startsAt: "desc" \}/);
});
