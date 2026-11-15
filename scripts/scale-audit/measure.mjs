// Response-time measurement against the production server (next start) on schema scale_audit.
// Usage: node measure.mjs <label> <outJson>
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:3110";
const [LABEL, OUT] = process.argv.slice(2);
const creds = JSON.parse(readFileSync(process.env.SCALE_AUDIT_CREDS ?? "creds.json", "utf8"));
const DB = (process.env.BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL ?? "").split("?")[0];
if (!/127\.0\.0\.1:5433\/.*verify/.test(DB)) throw new Error("refusing: verify cluster only");
const psql = (sql) => execFileSync("C:/Program Files/PostgreSQL/18/bin/psql.exe", [DB, "-X", "-At", "-c", sql], { encoding: "utf8", env: { ...process.env, PGOPTIONS: "-c search_path=scale_audit" } }).trim();

const now = () => Number(process.hrtime.bigint() / 1000n) / 1000;
const pct = (values, p) => { const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const round = (v) => Math.round(v * 10) / 10;

function cookieJar() { const jar = new Map(); return { add(res) { for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(";"); const [k, ...v] = pair.split("="); jar.set(k.trim(), v.join("=")); } }, header() { return [...jar].map(([k, v]) => `${k}=${v}`).join("; "); } }; }
async function req(path, { method = "GET", body, jar } = {}) {
  const headers = { "Content-Type": "application/json", Origin: BASE, ...(jar ? { Cookie: jar.header() } : {}) };
  const t = now();
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const text = await res.text();
  const ms = now() - t;
  jar?.add(res);
  return { ms, status: res.status, bytes: text.length, text };
}
async function login(path, email) {
  const jar = cookieJar();
  const r = await req(path, { method: "POST", body: { email, password: creds.password }, jar });
  if (r.status >= 300) throw new Error(`login ${path} ${r.status} ${r.text.slice(0, 200)}`);
  return jar;
}
function serverMemoryMb() {
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-Command", "(Get-Process -Id (Get-NetTCPConnection -LocalPort 3110 -State Listen).OwningProcess).WorkingSet64"], { encoding: "utf8" });
    return Math.round(Number(out.trim()) / 1048576);
  } catch { return null; }
}
const dbConnections = () => psql("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()");

const customer = await login("/api/auth/login", "scale-customer@verify.invalid");
const admin = await login("/api/admin/login", "scale-admin@verify.invalid");
// Products with enough base stock and no variants, one per order sample.
const orderProducts = psql(`SELECT p.id FROM "Product" p JOIN "Inventory" i ON i."productId" = p.id AND i."variantId" IS NULL WHERE p.status = 'ACTIVE' AND i.quantity - i.reserved >= 40 ORDER BY p.id LIMIT 40`).split(String.fromCharCode(10)).map((id) => id.trim()).filter(Boolean);

const pages = [
  ["home", "/"],
  ["products", "/products"],
  ["products-category", "/products?category=elektronika"],
  ["products-search", "/products?q=Smartfon"],
  ["products-search-rare", "/products?q=Nova%20qara%20777"],
  ["categories-category", "/categories?category=telefonlar"],
  ["store", "/stores/st1"],
  ["product", "/products/sp7"],
];
const results = { label: LABEL, products: Number(psql(`SELECT count(*) FROM "Product" WHERE status='ACTIVE'`)), memoryStartMb: serverMemoryMb(), rows: [] };

async function measure(name, run) {
  const cold = await run(0);
  const warm = [];
  let errors = cold.status >= 400 ? 1 : 0;
  let firstError = cold.status >= 400 ? cold.text.slice(0, 160) : null;
  let maxConn = Number(dbConnections());
  for (let i = 1; i <= 30; i++) {
    const r = await run(i);
    if (r.status >= 400) { errors++; firstError ??= r.text.slice(0, 160); }
    warm.push(r.ms);
    if (i % 10 === 0) maxConn = Math.max(maxConn, Number(dbConnections()));
  }
  const row = { name, cold: round(cold.ms), median: round(pct(warm, 50)), p95: round(pct(warm, 95)), max: round(Math.max(...warm)), status: cold.status, bytes: cold.bytes, errors, ...(firstError ? { firstError } : {}), dbConnections: maxConn };
  results.rows.push(row);
  console.log(JSON.stringify(row));
}

const ONLY = process.env.ONLY;
for (const [name, path] of pages) if (!ONLY) await measure(name, () => req(path, { jar: name === "home" ? undefined : undefined }));
if (!ONLY || ONLY === "cart") await measure("cart-api", () => req("/api/cart", { jar: customer }));
if (!ONLY || ONLY === "order") await measure("order-create", async (i) => {
  const add = await req("/api/cart/items", { method: "POST", body: { productId: orderProducts[i % orderProducts.length], quantity: 1 }, jar: customer });
  if (add.status >= 300) return add;
  return req("/api/orders", { method: "POST", body: { addressId: "scale-address" }, jar: customer });
});
if (!ONLY) await measure("admin-products", () => req("/admin/products", { jar: admin }));
results.memoryEndMb = serverMemoryMb();
results.dbConnectionsIdle = Number(dbConnections());
writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ memoryStartMb: results.memoryStartMb, memoryEndMb: results.memoryEndMb, dbConnectionsIdle: results.dbConnectionsIdle, products: results.products }));
