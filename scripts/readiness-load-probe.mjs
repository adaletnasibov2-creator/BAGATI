import "dotenv/config";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { isolatedRestoreTargets } from "./isolated-restore-drill.mjs";

const port = 47321;
const origin = `http://127.0.0.1:${port}`;
const durationMs = 8_000;

function percentile(samples, ratio) {
  if (!samples.length) return null;
  const index = Math.min(samples.length - 1, Math.ceil(ratio * samples.length) - 1);
  return Math.round(samples[index] * 10) / 10;
}

async function measure(pathname, concurrency) {
  const url = `${origin}${pathname}`;
  const deadline = Date.now() + durationMs;
  const samples = [];
  let errors = 0;
  async function worker() {
    while (Date.now() < deadline) {
      const started = performance.now();
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) errors += 1;
        else samples.push(performance.now() - started);
      } catch {
        errors += 1;
      }
    }
  }
  const started = Date.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const elapsed = (Date.now() - started) / 1000;
  samples.sort((left, right) => left - right);
  const average = samples.length ? Math.round((samples.reduce((sum, value) => sum + value, 0) / samples.length) * 10) / 10 : null;
  return {
    path: pathname,
    concurrency,
    requests: samples.length + errors,
    success: samples.length,
    errors,
    errorRate: samples.length + errors ? Math.round((errors / (samples.length + errors)) * 1000) / 10 : 100,
    rps: Math.round((samples.length / elapsed) * 10) / 10,
    avgMs: average,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    p99Ms: percentile(samples, 0.99),
  };
}

async function waitForReady(child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Isolated server exited before it became ready.");
    try {
      const response = await fetch(`${origin}/api/health`, { cache: "no-store" });
      if (response.ok) return;
    } catch { /* The server is still starting. */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("Isolated server did not answer liveness in time.");
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Refusing load probe: DATABASE_URL is not configured.");
  const targets = isolatedRestoreTargets(process.env.DATABASE_URL);
  const distDir = process.env.BAGATI_NEXT_DIST_DIR;
  if (distDir !== ".next-launch-verify") throw new Error("Refusing load probe: BAGATI_NEXT_DIST_DIR must be the isolated launch build.");
  const child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, DATABASE_URL: targets.drillUrl, PORT: String(port) },
    stdio: "ignore",
  });
  try {
    await waitForReady(child);
    const results = [];
    for (const concurrency of [5, 10]) {
      results.push(await measure("/api/health", concurrency));
      results.push(await measure("/api/ready", concurrency));
    }
    const memory = process.memoryUsage();
    console.log(JSON.stringify({
      database: targets.drillName,
      origin,
      thinkTimeMs: 0,
      durationMs,
      results,
      probeMemoryMb: Math.round(memory.rss / 1048576),
    }));
  } finally {
    if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Load probe failed.";
  console.error(message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://redacted"));
  process.exitCode = 1;
});
