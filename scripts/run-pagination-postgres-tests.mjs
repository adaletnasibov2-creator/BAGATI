import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import {
  assertTemporaryPostgresLayout,
  assertTemporaryPostgresListenerIdentity,
  assertTemporaryPostgresRoot,
} from "./pagination-postgres-listener-identity.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nonce = randomUUID().replaceAll("-", "");
let runDirectory;
let serverStarted = false;
let postgresProcess;

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: options.env ?? process.env,
      stdio: "inherit",
      windowsHide: true,
      shell: options.shell ?? false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${options.label ?? path.basename(command)} exited with ${code ?? signal ?? "unknown status"}.`));
    });
  });
}

async function resolvePostgresBin() {
  const candidates = [
    process.env.BAGATI_PG_BIN,
    "C:\\Program Files\\PostgreSQL\\18\\bin",
  ].filter(Boolean);
  for (const directory of candidates) {
    try {
      await Promise.all(["initdb.exe", "pg_ctl.exe", "psql.exe"].map((file) => access(path.join(directory, file))));
      return directory;
    } catch { /* Try the next known installation path. */ }
  }
  throw new Error("PostgreSQL server binaries were not found. Set BAGATI_PG_BIN to an existing bin directory; nothing was installed.");
}

async function reserveLoopbackPort() {
  const { createServer } = await import("node:net");
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a local PostgreSQL test port.");
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (port === 5432) throw new Error("Refusing the ordinary PostgreSQL port for test provisioning.");
  return port;
}

async function waitForLoopbackPostgres(child, port) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("The isolated PostgreSQL process exited before becoming ready.");
    const connected = await new Promise((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 400);
      socket.once("connect", () => { clearTimeout(timer); socket.destroy(); resolve(true); });
      socket.once("error", () => { clearTimeout(timer); resolve(false); });
    });
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("The isolated loopback PostgreSQL server did not become ready before timeout.");
}

async function runIdentityGatedSetup(pgBin, port, dataDirectory, bootstrapPassword, setupSql) {
  const marker = `BAGATI_POSTGRES_IDENTITY_${randomUUID().replaceAll("-", "")}`;
  const identityQuery = `SELECT json_build_array(current_setting('data_directory'), '${marker}')::text;`;
  const child = spawn(path.join(pgBin, "psql.exe"), [
    "-X", "-q", "-w", "-A", "-t", "-v", "ON_ERROR_STOP=1",
    "-h", "127.0.0.1", "-p", String(port),
    "-U", "bagati_pagination_bootstrap", "-d", "postgres",
  ], {
    cwd: projectRoot,
    env: { ...process.env, PGPASSWORD: bootstrapPassword },
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  });

  let output = "";
  let markerResolve;
  let markerReject;
  const markerPromise = new Promise((resolve, reject) => { markerResolve = resolve; markerReject = reject; });
  const exitPromise = new Promise((resolve) => {
    child.once("error", () => {
      markerReject(new Error("Could not start the isolated PostgreSQL identity probe."));
      resolve({ code: null, signal: "spawn-error" });
    });
    child.once("exit", (code, signal) => {
      markerReject(new Error("PostgreSQL listener identity probe exited before validation."));
      resolve({ code, signal });
    });
  });

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (output.length > 16_384) {
      markerReject(new Error("PostgreSQL listener identity response exceeded its safe limit."));
      return;
    }
    if (output.includes(marker)) markerResolve(output.slice(0, output.indexOf(marker)));
  });

  const markerTimer = setTimeout(() => markerReject(new Error("PostgreSQL listener identity probe timed out.")), 10_000);
  child.stdin.write(`${identityQuery}\n`);

  let identityOutput;
  try {
    identityOutput = await markerPromise;
  } catch (error) {
    child.stdin.end("\\q\n");
    const result = await Promise.race([exitPromise, new Promise((resolve) => setTimeout(() => resolve(null), 1_000))]);
    if (result === null && child.exitCode === null && child.signalCode === null) child.kill();
    await exitPromise;
    clearTimeout(markerTimer);
    throw error;
  }
  clearTimeout(markerTimer);

  let reportedDataDirectory;
  try {
    const responseLines = identityOutput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (responseLines.length !== 1) throw new Error("PostgreSQL listener returned an invalid identity response.");
    const identity = JSON.parse(responseLines[0]);
    if (!Array.isArray(identity) || identity.length !== 2 || identity[1] !== marker || typeof identity[0] !== "string") {
      throw new Error("PostgreSQL listener returned an invalid identity response.");
    }
    reportedDataDirectory = identity[0];
    assertTemporaryPostgresListenerIdentity({
      tempRoot: path.resolve(os.tmpdir()),
      runDirectory,
      dataDirectory,
      reportedDataDirectory,
    });
    if (postgresProcess?.exitCode !== null || child.exitCode !== null || child.signalCode !== null) {
      throw new Error("The spawned PostgreSQL listener exited before setup SQL.");
    }
  } catch {
    child.stdin.end("\\q\n");
    const result = await Promise.race([exitPromise, new Promise((resolve) => setTimeout(() => resolve(null), 1_000))]);
    if (result === null && child.exitCode === null && child.signalCode === null) child.kill();
    await exitPromise;
    throw new Error("PostgreSQL listener is not the runner-owned temporary cluster; setup SQL was not executed.");
  }

  try {
    child.stdin.write(`${setupSql}\n\\q\n`);
  } catch {
    child.kill();
    await exitPromise;
    throw new Error("The verified PostgreSQL identity connection closed before setup SQL.");
  }
  child.stdin.end();
  const result = await exitPromise;
  if (result.code !== 0) throw new Error(`Isolated PostgreSQL setup SQL exited with ${result.code ?? result.signal ?? "unknown status"}.`);
}

async function main() {
  const pgBin = await resolvePostgresBin();
  const tempRoot = path.resolve(os.tmpdir());
  assertTemporaryPostgresRoot({ tempRoot });
  runDirectory = await mkdtemp(path.join(tempRoot, "bagati-pagination-pg-"));
  if (!inside(tempRoot, path.resolve(runDirectory))) throw new Error("Refusing a temporary cluster outside the system temp directory.");
  const markerPath = path.join(runDirectory, ".bagati-pagination-run");
  await writeFile(markerPath, nonce, { encoding: "ascii", mode: 0o600 });

  const dataDirectory = path.join(runDirectory, "data");
  assertTemporaryPostgresLayout({
    tempRoot,
    runDirectory,
    dataDirectory,
  });
  const port = await reserveLoopbackPort();
  const bootstrapPassword = randomBytes(48).toString("base64url");
  const runnerPassword = randomBytes(48).toString("base64url");
  const passwordFile = path.join(runDirectory, "bootstrap-password.txt");
  await writeFile(passwordFile, bootstrapPassword, { encoding: "ascii", mode: 0o600 });

  await run(path.join(pgBin, "initdb.exe"), [
    "-D", dataDirectory,
    "-U", "bagati_pagination_bootstrap",
    `--pwfile=${passwordFile}`,
    "--auth-host=scram-sha-256",
    "--auth-local=trust",
    "--encoding=UTF8",
    "--no-locale",
    "--no-instructions",
  ], { label: "initdb" });
  await rm(passwordFile, { force: true });

  const logHandle = await open(path.join(runDirectory, "postgres.log"), "a");
  postgresProcess = spawn(path.join(pgBin, "postgres.exe"), ["-D", dataDirectory, "-h", "127.0.0.1", "-p", String(port)], {
    cwd: projectRoot,
    env: process.env,
    stdio: ["ignore", logHandle.fd, logHandle.fd],
    windowsHide: true,
  });
  await logHandle.close();
  serverStarted = true;
  await waitForLoopbackPostgres(postgresProcess, port);

  const setupSql = `REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
CREATE ROLE bagati_pagination_runner LOGIN PASSWORD '${runnerPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE DATABASE bagati_pagination_test OWNER bagati_pagination_runner;
REVOKE ALL ON DATABASE bagati_pagination_test FROM PUBLIC;
GRANT CONNECT, CREATE, TEMPORARY ON DATABASE bagati_pagination_test TO bagati_pagination_runner;
`;
  await runIdentityGatedSetup(pgBin, port, dataDirectory, bootstrapPassword, setupSql);

  const testUrl = `postgresql://bagati_pagination_runner:${runnerPassword}@127.0.0.1:${port}/bagati_pagination_test?schema=public`;
  const preloadPath = path.join(runDirectory, "node24-test-preload.cjs");
  const preload = `const os = require('node:os');
const { syncBuiltinESMExports } = require('node:module');
const originalUserInfo = os.userInfo.bind(os);
os.userInfo = (...args) => {
  try { return originalUserInfo(...args); }
  catch { return { uid: -1, gid: -1, username: 'bagati-test', homedir: process.env.TEMP || process.cwd(), shell: null }; }
};
syncBuiltinESMExports();
`;
  await writeFile(preloadPath, preload, { encoding: "utf8", mode: 0o600 });
  const nodeOptionsPath = preloadPath.replaceAll("\\", "/");
  const isolatedEnv = {
    ...process.env,
    BAGATI_PAGINATION_TEST_DATABASE_URL: testUrl,
    BAGATI_PAGINATION_TEST_PORT: String(port),
    NODE_OPTIONS: `--require=${nodeOptionsPath}`,
  };
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const npmOptions = { shell: process.platform === "win32" };

  await run(npmCommand, ["run", "verify:pagination-test-db"], { env: isolatedEnv, ...npmOptions, label: "database identity preflight" });
  const migrationEnv = { ...isolatedEnv, DATABASE_URL: testUrl };
  await run(npmCommand, ["exec", "--", "prisma", "migrate", "deploy"], { env: migrationEnv, ...npmOptions, label: "migrations on the fresh isolated database" });

  for (const script of [
    "test:customer-order-pagination",
    "test:public-product-catalog",
    "test:public-store-discovery",
    "test:search-term",
    "test:pagination:integration",
  ]) {
    await run(npmCommand, ["run", script], { env: isolatedEnv, ...npmOptions, label: script });
  }

  console.log("Unit and PostgreSQL pagination suites passed against this run's isolated temporary cluster.");
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown failure";
  console.error(`Isolated pagination test workflow stopped: ${message}`);
  process.exitCode = 1;
} finally {
  if (runDirectory) {
    const tempRoot = path.resolve(os.tmpdir());
    const resolvedRunDirectory = path.resolve(runDirectory);
    let owned = false;
    try { owned = (await readFile(path.join(resolvedRunDirectory, ".bagati-pagination-run"), "ascii")) === nonce; }
    catch { /* Missing ownership marker: cleanup is forbidden. */ }
    if (!inside(tempRoot, resolvedRunDirectory) || !owned) {
      console.error("Temporary cluster ownership could not be verified; cleanup was not attempted.");
    } else {
      const dataDirectory = path.join(resolvedRunDirectory, "data");
      if (serverStarted) {
        try {
          await run(path.join(await resolvePostgresBin(), "pg_ctl.exe"), ["-D", dataDirectory, "-m", "fast", "-w", "stop"], { label: "temporary PostgreSQL shutdown" });
          serverStarted = false;
        } catch {
          if (postgresProcess && postgresProcess.exitCode === null && postgresProcess.signalCode === null) {
            await new Promise((resolve) => {
              const timer = setTimeout(resolve, 5_000);
              postgresProcess.once("exit", () => { clearTimeout(timer); resolve(); });
              postgresProcess.kill("SIGINT");
            });
          }
          serverStarted = Boolean(postgresProcess && postgresProcess.exitCode === null && postgresProcess.signalCode === null);
          if (serverStarted) console.error(`The owned temporary PostgreSQL cluster could not be stopped; its files were preserved at ${resolvedRunDirectory}.`);
        }
      }
      if (!serverStarted) await rm(resolvedRunDirectory, { recursive: true, force: true });
    }
  }
}
