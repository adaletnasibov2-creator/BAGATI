/**
 * Startup log line with the effective Prisma pool settings (SCALE-FIX-4 A9). It does not change the pool.
 *
 * Only two query parameters of DATABASE_URL are read: connection_limit and pool_timeout, and only plain integers are
 * printed. Never the host, user, password, database, schema or any other part of the URL. When a value is not set,
 * Prisma's default applies: connection_limit = physical CPUs × 2 + 1, pool_timeout = 10 s; the line then says
 * "default" and shows the CPU count Node sees (logical CPUs, so an upper estimate of Prisma's figure).
 */
import { cpus } from "node:os";

type Env = Record<string, string | undefined>;

export type DbPoolInfo = { connectionLimit: string; poolTimeout: string; source: "DATABASE_URL" | "default" | "unreadable"; cpus: number };

function integerParam(params: URLSearchParams, name: string): string | null {
  const raw = params.get(name);
  return raw !== null && /^\d{1,4}$/.test(raw) ? raw : null;
}

export function describeDbPool(env: Env = process.env, cpuCount: number = cpus().length): DbPoolInfo {
  const raw = env.DATABASE_URL;
  let params: URLSearchParams | null = null;
  try { params = raw ? new URL(raw).searchParams : null; } catch { params = null; }
  if (!params) return { connectionLimit: "default", poolTimeout: "default", source: raw ? "unreadable" : "default", cpus: cpuCount };
  const connectionLimit = integerParam(params, "connection_limit");
  const poolTimeout = integerParam(params, "pool_timeout");
  return {
    connectionLimit: connectionLimit ?? "default",
    poolTimeout: poolTimeout ?? "default",
    source: connectionLimit || poolTimeout ? "DATABASE_URL" : "default",
    cpus: cpuCount,
  };
}

/** One JSON line, for example {"event":"db_pool","connection_limit":"10","pool_timeout":"10","source":"DATABASE_URL","cpus":4}. */
export function dbPoolLogLine(env: Env = process.env, cpuCount?: number): string {
  const info = describeDbPool(env, cpuCount);
  return JSON.stringify({ event: "db_pool", connection_limit: info.connectionLimit, pool_timeout: info.poolTimeout, source: info.source, cpus: info.cpus });
}
