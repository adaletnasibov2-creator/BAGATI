import "dotenv/config";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

const DRILL_NAME = "bagati_restore_drill";
const COPY_NAME = "bagati_restore_verify";
const ALLOWED_NAMES = new Set([DRILL_NAME, COPY_NAME]);

export function isolatedRestoreTargets(sourceUrl) {
  let source;
  try {
    source = new URL(sourceUrl);
  } catch {
    throw new Error("Refusing restore drill: DATABASE_URL is not a valid URL.");
  }
  if (!["postgres:", "postgresql:"].includes(source.protocol)) {
    throw new Error("Refusing restore drill: DATABASE_URL must use PostgreSQL.");
  }
  if (!["localhost", "127.0.0.1"].includes(source.hostname) || source.port !== "5432") {
    throw new Error("Refusing restore drill: only the local PostgreSQL server on port 5432 can be used.");
  }
  const configuredName = decodeURIComponent(source.pathname.replace(/^\/+/, ""));
  if (configuredName !== "bagati") {
    throw new Error("Refusing restore drill: the configured database must be the local development database so the drill target can be derived.");
  }
  const admin = new URL(source);
  admin.pathname = "/postgres";
  const drill = new URL(source);
  drill.pathname = `/${DRILL_NAME}`;
  const copy = new URL(source);
  copy.pathname = `/${COPY_NAME}`;
  for (const target of [drill, copy]) {
    const name = decodeURIComponent(target.pathname.replace(/^\/+/, ""));
    if (!ALLOWED_NAMES.has(name)) throw new Error("Refusing restore drill: target database name is not allowlisted.");
  }
  return {
    adminUrl: admin.toString(),
    drillUrl: drill.toString(),
    copyUrl: copy.toString(),
    drillName: DRILL_NAME,
    copyName: COPY_NAME,
  };
}

async function withClient(url, run) {
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    return await run(client);
  } finally {
    await client.$disconnect();
  }
}

async function databaseExists(adminUrl, name) {
  if (!ALLOWED_NAMES.has(name)) throw new Error("Refusing catalog lookup for a non-allowlisted database.");
  return withClient(adminUrl, async (client) => {
    const rows = await client.$queryRaw`SELECT datname FROM pg_database WHERE datname = ${name}`;
    return rows.length === 1;
  });
}

async function createEmptyDatabase(adminUrl, name) {
  if (!ALLOWED_NAMES.has(name)) throw new Error("Refusing to create a non-allowlisted database.");
  await withClient(adminUrl, (client) => client.$executeRawUnsafe(`CREATE DATABASE "${name}"`));
}

async function assertEmptyMarketplace(url, expectedName) {
  return withClient(url, async (client) => {
    const identity = await client.$queryRaw`SELECT current_database() AS name`;
    if (identity[0]?.name !== expectedName) throw new Error("Refusing restore drill: connected database does not match the isolated target.");
    const tables = await client.$queryRaw`
      SELECT c.relname AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    `;
    if (tables.length === 0) return { tables: 0, users: 0 };
    const users = tables.some((table) => table.name === "User")
      ? await client.$queryRaw`SELECT COUNT(*)::int AS count FROM "User"`
      : [{ count: 0 }];
    if (Number(users[0]?.count ?? 0) > 0) {
      throw new Error("Refusing restore drill: the isolated database already contains user rows.");
    }
    return { tables: tables.length, users: 0 };
  });
}

function migrateDeploy(url) {
  const started = Date.now();
  const prismaCli = resolve("node_modules", "prisma", "build", "index.js");
  const result = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (/bagati_restore_drill|bagati_restore_verify/.test(detail) && /error/i.test(detail)) {
      throw new Error("Prisma migrate deploy failed for the isolated restore database.");
    }
    throw new Error("Prisma migrate deploy failed for the isolated restore database.");
  }
  return Date.now() - started;
}

async function schemaFacts(url, expectedName) {
  return withClient(url, async (client) => {
    const identity = await client.$queryRaw`SELECT current_database() AS name, current_setting('server_version') AS version`;
    if (identity[0]?.name !== expectedName) throw new Error("Schema check connected to an unexpected database.");
    const tables = await client.$queryRaw`SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
    const foreignKeys = await client.$queryRaw`SELECT COUNT(*)::int AS count FROM information_schema.table_constraints WHERE table_schema = 'public' AND constraint_type = 'FOREIGN KEY'`;
    const migrations = await client.$queryRaw`SELECT COUNT(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    return {
      database: identity[0].name,
      version: identity[0].version,
      tables: Number(tables[0].count),
      foreignKeys: Number(foreignKeys[0].count),
      migrations: Number(migrations[0].count),
    };
  });
}

function dumpBinary() {
  const candidates = ["pg_dump"];
  if (process.platform === "win32" && process.env.ProgramFiles) {
    candidates.unshift(join(process.env.ProgramFiles, "PostgreSQL", "18", "bin", "pg_dump.exe"));
  }
  return candidates.find((candidate) => spawnSync(candidate, ["--version"], { encoding: "utf8" }).status === 0) ?? null;
}

function restoreBinary(dumpTool) {
  if (dumpTool === "pg_dump") return "pg_restore";
  return join(dirname(dumpTool), "pg_restore.exe");
}

function libpqUrl(value) {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.toString();
}

function dumpAndRestore(drillUrl, copyUrl) {
  const dumpTool = dumpBinary();
  if (!dumpTool) return { available: false };
  const directory = mkdtempSync(join(tmpdir(), "bagati-restore-"));
  const file = join(directory, "schema.dump");
  const startedDump = Date.now();
  const dumped = spawnSync(dumpTool, ["--schema-only", "--format=custom", "--file", file, "--no-owner", libpqUrl(drillUrl)], { encoding: "utf8" });
  const dumpMs = Date.now() - startedDump;
  if (dumped.status !== 0) {
    rmSync(directory, { recursive: true, force: true });
    const detail = `${dumped.stderr ?? ""}${dumped.stdout ?? ""}`.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://redacted").replace(/password=\S+/gi, "password=redacted").slice(0, 400);
    throw new Error(`pg_dump failed for the isolated restore database. ${detail}`);
  }
  const bytes = statSync(file).size;
  const startedRestore = Date.now();
  const restored = spawnSync(restoreBinary(dumpTool), ["--dbname", libpqUrl(copyUrl), "--no-owner", "--exit-on-error", file], { encoding: "utf8" });
  const restoreMs = Date.now() - startedRestore;
  rmSync(directory, { recursive: true, force: true });
  if (restored.status !== 0) {
    const detail = `${restored.stderr ?? ""}`.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://redacted").slice(0, 400);
    throw new Error(`pg_restore failed for the isolated verification database. ${detail}`);
  }
  return { available: true, bytes, dumpMs, restoreMs };
}

async function main() {
  const source = process.env.DATABASE_URL;
  if (!source) throw new Error("Refusing restore drill: DATABASE_URL is not configured.");
  const targets = isolatedRestoreTargets(source);
  const drillExists = await databaseExists(targets.adminUrl, targets.drillName);
  if (!drillExists) await createEmptyDatabase(targets.adminUrl, targets.drillName);
  await assertEmptyMarketplace(targets.drillUrl, targets.drillName);
  const migrateMs = migrateDeploy(targets.drillUrl);
  const drill = await schemaFacts(targets.drillUrl, targets.drillName);
  const copyExists = await databaseExists(targets.adminUrl, targets.copyName);
  if (!copyExists) await createEmptyDatabase(targets.adminUrl, targets.copyName);
  const copyBefore = await assertEmptyMarketplace(targets.copyUrl, targets.copyName);
  const dump = copyBefore.tables > 0 ? { available: false, alreadyRestored: true, tool: "already-restored" } : dumpAndRestore(targets.drillUrl, targets.copyUrl);
  const copy = dump.available || dump.alreadyRestored ? await schemaFacts(targets.copyUrl, targets.copyName) : null;
  console.log(JSON.stringify({
    drillDatabase: drill.database,
    serverVersion: drill.version,
    tables: drill.tables,
    foreignKeys: drill.foreignKeys,
    appliedMigrations: drill.migrations,
    migrateMs,
    dumpTool: dump.available ? "pg_dump" : dump.tool ?? "unavailable",
    dumpBytes: dump.bytes ?? null,
    dumpMs: dump.dumpMs ?? null,
    restoreMs: dump.restoreMs ?? null,
    verifyDatabase: copy?.database ?? null,
    verifyTables: copy?.tables ?? null,
    verifyMigrations: copy?.migrations ?? null,
    verifyForeignKeys: copy?.foreignKeys ?? null,
    schemaMatch: copy ? copy.tables === drill.tables && copy.foreignKeys === drill.foreignKeys : null,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Isolated restore drill failed.";
    console.error(message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://redacted"));
    process.exitCode = 1;
  });
}
