/**
 * POST /api/orders (SCALE-FIX-1 A7): stock errors are 409 with Azerbaijani messages (were 500); the whole Serializable
 * transaction is retried up to 2 times with a short random wait ONLY on Prisma P2034; the transaction itself, its
 * locks and the double-submit protections are unchanged. The real-PostgreSQL error code of a concurrent-buyer
 * conflict is checked in scripts/scale-fix-1.integration.test.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { isOrderSerializationConflict, ORDER_TRANSACTION_MAX_RETRIES, orderRetryDelayMs, withOrderSerializationRetry } from "../lib/order-transaction-retry";
import { ORDER_STOCK_ERROR_CODES, ORDER_STOCK_ERROR_MESSAGES } from "../lib/order-stock-errors";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const route = read("app/api/orders/route.ts");
const form = read("components/checkout-form.tsx");
const prismaError = (code: string, meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError(`test ${code}`, { code, clientVersion: "test", meta });

test("only serialization conflicts count: P2034, or P2010 with SQLSTATE 40001", () => {
  assert.equal(isOrderSerializationConflict(prismaError("P2034")), true);
  assert.equal(isOrderSerializationConflict(prismaError("P2010", { code: "40001", message: "could not serialize access due to concurrent update" })), true);
  for (const other of [prismaError("P2028"), prismaError("P2024"), prismaError("P2010"), prismaError("P2010", { code: "40P01" }), prismaError("P2010", { code: "23505" }), prismaError("P2010", { code: 40001 }), prismaError("P2002"), new Error("STOCK_CHANGED"), new Error("VARIANT_OUT_OF_STOCK"), "P2034", null]) {
    assert.equal(isOrderSerializationConflict(other), false, String(other instanceof Error ? other.message : other));
  }
});

test("retry: up to 2 retries on P2034, then the conflict is thrown", async () => {
  assert.equal(ORDER_TRANSACTION_MAX_RETRIES, 2);
  const waits: number[] = [];
  let calls = 0;
  await assert.rejects(withOrderSerializationRetry(async () => { calls += 1; throw prismaError("P2034"); }, { sleep: async (ms) => { waits.push(ms); }, random: () => 0 }), (error: unknown) => isOrderSerializationConflict(error));
  assert.equal(calls, 3, "first attempt + 2 retries");
  assert.deepEqual(waits, [25, 50]);
});

test("retry: a conflict followed by success returns the order", async () => {
  let calls = 0;
  const order = await withOrderSerializationRetry(async () => { calls += 1; if (calls < 3) throw prismaError("P2034"); return { id: "order-1" }; }, { sleep: async () => {} });
  assert.deepEqual(order, { id: "order-1" });
  assert.equal(calls, 3);
});

test("retry: any other error is thrown at once, never retried", async () => {
  for (const error of [new Error("VARIANT_OUT_OF_STOCK"), new Error("CART_EMPTY"), prismaError("P2028"), prismaError("P2024"), prismaError("P2010")]) {
    let calls = 0;
    await assert.rejects(withOrderSerializationRetry(async () => { calls += 1; throw error; }, { sleep: async () => { throw new Error("must not wait"); } }), (thrown: unknown) => thrown === error);
    assert.equal(calls, 1);
  }
});

test("retry waits are short and random: 25-100 ms, then 50-200 ms", () => {
  assert.equal(orderRetryDelayMs(1, () => 0), 25);
  assert.equal(orderRetryDelayMs(1, () => 1), 100);
  assert.equal(orderRetryDelayMs(2, () => 0), 50);
  assert.equal(orderRetryDelayMs(2, () => 1), 200);
});

test("the route wraps the order transaction (ReadCommitted since CHECKOUT-CONCURRENCY-1); locks and double-submit protections stay", () => {
  assert.match(route, /const order=await withOrderSerializationRetry\(\(\)=>db\.\$transaction\(async\(transaction:any\)=>\{/);
  assert.match(route, /\},\{isolationLevel:Prisma\.TransactionIsolationLevel\.ReadCommitted,maxWait:10000,timeout:20000\}\)\);/);
  assert.match(route, /SELECT "id" FROM "Cart" WHERE "userId" = \$1 FOR UPDATE/, "the buyer's cart row is locked first");
  assert.match(route, /SELECT "id" FROM "Inventory" WHERE "id" = \$1 FOR UPDATE/, "stock rows are locked");
  // CHECKOUT-CONCURRENCY-1: still inside the transaction, now only the cart lines this order read.
  assert.match(route, /if\(cart\)await tx\.cartItem\.deleteMany\(\{where:\{cartId:cart\.id,id:\{in:items\.map\(\(item\)=>item\.id\)\}\}\}\)/, "the cart is emptied inside the transaction");
  assert.match(route, /code==="CART_EMPTY"\|\|code==="STOCK_CHANGED"\?409/);
  assert.equal(route.match(/withOrderSerializationRetry/g)?.length, 2, "import + one use");
  // Retries used up: the existing 409 TRANSACTION_CONFLICT, for both forms of the conflict.
  assert.match(route, /if\(isOrderSerializationConflict\(error\)\)return NextResponse\.json\(\{error:"Sifariş zamanı uyğunluq və ya stok məlumatları dəyişdi\. Səbəti yeniləyib yenidən cəhd edin\.",code:"TRANSACTION_CONFLICT"\},\{status:409\}\);/);
  assert.doesNotMatch(route, /error\.code==="P2034"/);
});

test("stock errors: 409 with Azerbaijani messages instead of 500", () => {
  assert.deepEqual(Object.keys(ORDER_STOCK_ERROR_MESSAGES).sort(), ["VARIANT_INACTIVE", "VARIANT_INVENTORY_MISSING", "VARIANT_OUT_OF_STOCK", "VARIANT_REQUIRED"]);
  assert.equal(ORDER_STOCK_ERROR_MESSAGES.VARIANT_OUT_OF_STOCK, "Məhsul bitib və ya səbətdəki miqdar qədər qalmayıb. Səbəti yeniləyin.");
  for (const message of Object.values(ORDER_STOCK_ERROR_MESSAGES)) assert.match(message, /Səbəti yeniləyin\.$/);
  assert.match(route, /STOCK_CHANGED:"Stok dəyişib\. Səbəti yeniləyib yenidən yoxlayın\.",\.\.\.ORDER_STOCK_ERROR_MESSAGES\};/);
  // Existing rule: a known code that is not one of the special cases is 409; unknown codes stay 500.
  assert.match(route, /code in messages\?409:500/);
  assert.match(read("lib/product-variants.ts"), /throw new Error\("VARIANT_OUT_OF_STOCK"\)/);
});

test("the checkout form shows the message, reloads the cart data and links to the cart for stock problems", () => {
  assert.deepEqual(ORDER_STOCK_ERROR_CODES, ["STOCK_CHANGED", "VARIANT_OUT_OF_STOCK", "VARIANT_REQUIRED", "VARIANT_INACTIVE", "VARIANT_INVENTORY_MISSING"]);
  // CART-DELIVERY: every stock code still reloads the cart data and offers the cart link; item refusals were added.
  assert.match(form, /const CART_PROBLEM_CODES=\[\.\.\.ORDER_STOCK_ERROR_CODES,"STORE_UNAVAILABLE","PRODUCT_UNAVAILABLE","VARIANT_INVALID"\];/);
  assert.match(form, /if\(CART_PROBLEM_CODES\.includes\(data\.code\)\)\{setStockProblem\(true\);router\.refresh\(\)\}/);
  assert.match(form, /\{error&&<div className="mt-3"><ErrorState message=\{error\}\/>\{stockProblem&&<Link href="\/cart" className="[^"]*min-h-11[^"]*">Səbətə keç<\/Link>\}<\/div>\}/);
  assert.match(form, /async function placeOrder\(\)\{setError\(""\);setStockProblem\(false\);/);
  assert.doesNotMatch(read("lib/order-stock-errors.ts"), /@prisma\/client|import /, "browser-safe module");
});
