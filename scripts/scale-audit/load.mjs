// Closed-loop load test: N concurrent "visitors" each request the URL again as soon as the previous answer arrives.
// Usage: node scripts/scale-audit/load.mjs <outJson> [seconds]
// Samples DB connections (verify cluster only) and server memory once per second.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
import { writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:3110";
const [OUT, SECONDS = "20"] = process.argv.slice(2);
const DB = (process.env.BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL ?? "").split("?")[0];
if (!/127\.0\.0\.1:5433\/.*verify/.test(DB)) throw new Error("refusing: verify cluster only");
// Node's built-in fetch: keep-alive, no per-origin connection limit.

// Async sampling only: a synchronous child process would block this client's event loop and fake timeouts.
const psql = async (sql) => (await execFileAsync("C:/Program Files/PostgreSQL/18/bin/psql.exe", [DB, "-X", "-At", "-c", sql], { encoding: "utf8" })).stdout.trim();
const dbStates = () => psql("SELECT coalesce(string_agg(state || ':' || n, ' '), '') FROM (SELECT coalesce(state, 'none') AS state, count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() GROUP BY 1) s");
const memoryMb = async () => { try { return Math.round(Number((await execFileAsync("powershell", ["-NoProfile", "-Command", "(Get-Process -Id (Get-NetTCPConnection -LocalPort 3110 -State Listen).OwningProcess).WorkingSet64"], { encoding: "utf8" })).stdout.trim()) / 1048576); } catch { return null; } };
const pct = (values, p) => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]); };

/** Wait until the previous run has fully drained: no active DB query and a quick probe answers in < 1.5 s. */
async function settle() {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const states = await dbStates().catch(() => "");
    const active = Number(/active:(\d+)/.exec(states)?.[1] ?? 0);
    const t = performance.now();
    const ok = await fetch(BASE + "/icon.svg").then((r) => r.arrayBuffer()).then(() => true).catch(() => false);
    if (active === 0 && ok && performance.now() - t < 1500) { await new Promise((r) => setTimeout(r, 2000)); return; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(JSON.stringify({ warning: "server did not settle within 180 s" }));
}

const targets = [["home", "/"], ["category", "/products?category=elektronika"], ["product", "/products/sp7"], ["search", "/products?q=Smartfon"]];
const levels = (process.env.LEVELS ?? "25,100,300").split(",").map(Number);
const results = [];

async function run(name, path, concurrency) {
  const latencies = []; let ok = 0, errors5xx = 0, errorsOther = 0, timeouts = 0;
  const stopAt = Date.now() + Number(SECONDS) * 1000;
  const samples = [];
  let sampling = true;
  const sampler = (async () => {
    let tick = 0;
    while (sampling) {
      const [db, mem] = await Promise.all([dbStates().catch(() => ""), tick % 5 === 0 ? memoryMb() : Promise.resolve(null)]);
      samples.push({ db, mem });
      tick++;
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();
  const worker = async () => {
    while (Date.now() < stopAt) {
      const t = performance.now();
      try {
        const res = await fetch(BASE + path, { signal: AbortSignal.timeout(30_000) });
        await res.arrayBuffer();
        const ms = performance.now() - t;
        latencies.push(ms);
        if (res.status >= 500) errors5xx++; else if (res.status >= 400) errorsOther++; else ok++;
      } catch (error) {
        if (error?.name === "TimeoutError") timeouts++; else errorsOther++;
      }
    }
  };
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsed = (performance.now() - started) / 1000;
  sampling = false;
  await sampler;
  const total = ok + errors5xx + errorsOther + timeouts;
  const maxActive = Math.max(0, ...samples.map((s) => Number(/active:(\d+)/.exec(s.db)?.[1] ?? 0)));
  const maxTotalConn = Math.max(0, ...samples.map((s) => s.db.split(" ").reduce((n, part) => n + Number(part.split(":")[1] ?? 0), 0)));
  const row = { name, concurrency, seconds: Math.round(elapsed), requests: total, rps: Math.round((total / elapsed) * 10) / 10,
    p50: pct(latencies, 50), p95: pct(latencies, 95), p99: pct(latencies, 99), max: Math.round(Math.max(0, ...latencies)),
    errorRatePct: total ? Math.round(((errors5xx + errorsOther + timeouts) / total) * 1000) / 10 : null, errors5xx, errorsOther, timeouts,
    dbConnectionsMax: maxTotalConn, dbActiveMax: maxActive, serverMemoryMaxMb: Math.max(0, ...samples.map((s) => s.mem ?? 0)) };
  results.push(row);
  console.log(JSON.stringify(row));
}

for (const [name, path] of targets) await fetch(BASE + path).then((r) => r.arrayBuffer()); // warm
for (const concurrency of levels) for (const [name, path] of targets) {
  await settle();
  await run(name, path, concurrency);
}
writeFileSync(OUT, JSON.stringify(results, null, 2));
