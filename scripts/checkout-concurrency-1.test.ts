/**
 * CHECKOUT-CONCURRENCY-1 (static part): POST /api/orders runs at ReadCommitted (was Serializable) and every explicit
 * protection that carries correctness is still in place, in the right order. The real-database proof (truly concurrent
 * requests against a running server) is scripts/checkout-concurrency-1.integration.test.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ORDER_CREATE_IP_RATE_LIMIT, ORDER_CREATE_RATE_LIMIT } from "../lib/form-rate-limit";
import { ORDER_TRANSACTION_MAX_RETRIES } from "../lib/order-transaction-retry";

const route = readFileSync(join(__dirname, "..", "app/api/orders/route.ts"), "utf8").replace(/\r\n/g, "\n");
const post = route.slice(route.indexOf("export async function POST"));
const tx = post.slice(post.indexOf("const order=await withOrderSerializationRetry"), post.indexOf("},{isolationLevel:"));
const at = (needle: string) => { const index = tx.indexOf(needle); assert.ok(index >= 0, `missing: ${needle}`); return index; };

test("isolation: ReadCommitted, same timeouts, still wrapped by the conflict retry", () => {
  assert.match(post, /\},\{isolationLevel:Prisma\.TransactionIsolationLevel\.ReadCommitted,maxWait:10000,timeout:20000\}\)\);/);
  assert.doesNotMatch(post, /TransactionIsolationLevel\.Serializable/);
  assert.equal(ORDER_TRANSACTION_MAX_RETRIES, 2);
  assert.match(post, /const order=await withOrderSerializationRetry\(\(\)=>db\.\$transaction\(/);
});

test("I2 (owner condition 1): the Cart row is locked BEFORE the cart and its items are read", () => {
  const lock = at(`await tx.$queryRawUnsafe('SELECT "id" FROM "Cart" WHERE "userId" = $1 FOR UPDATE',user.id);`);
  const read = at("const cart=await tx.cart.findUnique({where:{userId:user.id},include:{items:");
  const empty = at('if(!items.length)throw new Error("CART_EMPTY")');
  assert.ok(lock < read && read < empty, "lock -> read items -> CART_EMPTY check");
  // Nothing reads the cart or its items before the lock.
  assert.doesNotMatch(tx.slice(0, lock), /tx\.cart\.|tx\.cartItem\./);
  // Emptied in the same transaction: exactly the lines this order read.
  assert.match(tx, /if\(cart\)await tx\.cartItem\.deleteMany\(\{where:\{cartId:cart\.id,id:\{in:items\.map\(\(item\)=>item\.id\)\}\}\}\);return created;/);
});

test("I1 / I7: stock rows locked in sorted id order, re-read after the lock, conditional decrement unchanged", () => {
  const sort = at("normalized.sort((a:any,b:any)=>a.inventoryId.localeCompare(b.inventoryId));");
  const loop = at("for(const row of normalized){");
  const lock = at(`await tx.$queryRawUnsafe('SELECT "id" FROM "Inventory" WHERE "id" = $1 FOR UPDATE',row.inventoryId);`);
  const reread = at("const current=await tx.inventory.findUnique({where:{id:row.inventoryId}});");
  const update = at("const changed=await tx.inventory.updateMany({where:{id:current.id,quantity:{gte:current.reserved+row.item.quantity},reserved:current.reserved},data:{quantity:{decrement:row.item.quantity}}});if(changed.count!==1)throw new Error(\"STOCK_CHANGED\");");
  assert.ok(sort < loop && loop < lock && lock < reread && reread < update);
  assert.match(tx, /try\{quantityAfterSale\(current\.quantity,current\.reserved,row\.item\.quantity\)\}catch\{throw new Error\("STOCK_CHANGED"\)\}/);
  // The only other explicit row lock is the buyer's own Cart row.
  assert.equal((tx.match(/FOR UPDATE/g) ?? []).length, 2);
});

test("I3 / I5: expectedPrices, price validity and store/product eligibility checks are unchanged and inside the transaction", () => {
  assert.match(tx, /const eligibleProductIds=await resolvePublicProductEligibility\(productCandidates,tx,now\);if\(productCandidates\.some\(\(product:any\)=>!eligibleProductIds\.has\(product\.id\)\)\)throw new Error\("STORE_UNAVAILABLE"\);/);
  assert.match(tx, /const expected=expectedPriceMap\.get\(item\.id\);if\(expected&&!expected\.eq\(unitPrice\)\)throw new Error\("PRICE_CHANGED"\);/);
  assert.match(tx, /if\(!price\.isFinite\(\)\|\|price\.lte\(0\)\|\|!unitPrice\.isFinite\(\)\|\|unitPrice\.lte\(0\)\)throw new Error\("PRICE_INVALID"\)/);
  assert.match(tx, /if\(product\.status!=="ACTIVE"\)throw new Error\("PRODUCT_UNAVAILABLE"\)/);
  assert.match(tx, /const commissionRates = await commissionRatesForNewOrder\(tx,/);
  // Eligibility and prices are read after the Cart lock and before the stock locks, all in the same transaction.
  assert.ok(at(`FROM "Cart" WHERE "userId" = $1 FOR UPDATE`) < at("resolvePublicProductEligibility(") && at("resolvePublicProductEligibility(") < at(`FROM "Inventory" WHERE "id" = $1 FOR UPDATE`));
});

test("I4: one order with one store order per store, created in the same transaction as the stock changes", () => {
  assert.match(tx, /const groups=new Map<string,any\[\]>\(\);for\(const row of normalized\)\{const storeId=row\.item\.product\.store\.id;/);
  assert.match(tx, /const created=await tx\.order\.create\(\{data:\{userId:user\.id,status:"PENDING",[\s\S]*storeOrders:\{create:storeOrders\.map\(/);
  assert.match(tx, /payments:\{create:\{amount:total,currency:"AZN",status:"PENDING"\}\}/, "orders stay 'Ödəniş gözləyir'");
});

test("I6: rate limits and the AZ mobile phone rule are unchanged and stay outside / before the stock step", () => {
  assert.deepEqual(ORDER_CREATE_RATE_LIMIT, { limit: 10, windowMs: 60 * 60 * 1000 });
  assert.deepEqual(ORDER_CREATE_IP_RATE_LIMIT, { limit: 60, windowMs: 60 * 60 * 1000 });
  assert.ok(post.indexOf("withinFormRateLimits(") < post.indexOf("const order=await withOrderSerializationRetry"));
  assert.match(tx, /const orderPhone=normalizeAzMobilePhone\(address\.phone\);if\(!orderPhone\)throw new Error\("PHONE_INVALID"\);/);
  assert.ok(at('throw new Error("PHONE_INVALID")') < at(`FROM "Cart" WHERE "userId" = $1 FOR UPDATE`));
});

test("true conflicts keep the existing codes, messages and statuses", () => {
  assert.match(post, /if\(isOrderSerializationConflict\(error\)\)return NextResponse\.json\(\{error:"Sifariş zamanı uyğunluq və ya stok məlumatları dəyişdi\. Səbəti yeniləyib yenidən cəhd edin\.",code:"TRANSACTION_CONFLICT"\},\{status:409\}\);/);
  assert.match(post, /const status=code==="CART_EMPTY"\|\|code==="STOCK_CHANGED"\?409:code==="ADDRESS_INVALID"\?404:code==="PHONE_INVALID"\?422:code==="SESSION_EXPIRED"\?401:code in messages\?409:500;/);
});
