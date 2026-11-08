import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function validateStagingMigrationTarget(env = process.env) {
  if (env.BAGATI_ENV !== "staging") {
    throw new Error("Refusing migration: BAGATI_ENV must be staging.");
  }
  if (env.BAGATI_STAGING_CONFIRM !== "bagati-staging") {
    throw new Error("Refusing migration: set BAGATI_STAGING_CONFIRM to bagati-staging after verifying the target.");
  }
  if (!env.DATABASE_URL) {
    throw new Error("Refusing migration: DATABASE_URL is required.");
  }
  if (!env.BAGATI_STAGING_DATABASE_HOST?.trim()) {
    throw new Error("Refusing migration: set BAGATI_STAGING_DATABASE_HOST from the staging provider panel.");
  }

  let target;
  try {
    target = new URL(env.DATABASE_URL);
  } catch {
    throw new Error("Refusing migration: DATABASE_URL is not a valid URL.");
  }

  if (!["postgres:", "postgresql:"].includes(target.protocol)) {
    throw new Error("Refusing migration: DATABASE_URL must use PostgreSQL.");
  }
  if (decodeURIComponent(target.pathname.replace(/^\/+/, "")) !== "bagati_staging") {
    throw new Error("Refusing migration: database name must be exactly bagati_staging.");
  }
  if (!target.hostname || ["localhost", "127.0.0.1", "::1"].includes(target.hostname)) {
    throw new Error("Refusing migration: a remote staging database is required.");
  }
  if (target.hostname.toLowerCase() !== env.BAGATI_STAGING_DATABASE_HOST.trim().toLowerCase()) {
    throw new Error("Refusing migration: DATABASE_URL host does not match BAGATI_STAGING_DATABASE_HOST.");
  }

  return { database: "bagati_staging" };
}

function run() {
  const target = validateStagingMigrationTarget();
  const prismaCli = resolve("node_modules", "prisma", "build", "index.js");
  if (!existsSync(prismaCli)) {
    throw new Error("Prisma CLI is not installed; install dependencies before running the staging migration.");
  }
  console.log(`Applying committed migrations to verified database: ${target.database}`);
  const result = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Staging migration refused.");
    process.exitCode = 1;
  }
}
