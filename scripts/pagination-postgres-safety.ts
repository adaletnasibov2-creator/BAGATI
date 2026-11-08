import type { PrismaClient } from "@prisma/client";

const DATABASE_NAME = "bagati_pagination_test";
const DATABASE_ROLE = "bagati_pagination_runner";

export function requirePaginationTestUrl(env: NodeJS.ProcessEnv = process.env): URL {
  const rawUrl = env.BAGATI_PAGINATION_TEST_DATABASE_URL;
  if (!rawUrl) throw new Error("BAGATI_PAGINATION_TEST_DATABASE_URL is required; no database fallback is allowed.");

  let url: URL;
  try { url = new URL(rawUrl); }
  catch { throw new Error("The dedicated pagination test database URL is invalid."); }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const port = Number(url.port);
  if (!/^postgres(?:ql)?:$/.test(url.protocol)
    || url.hostname !== "127.0.0.1"
    || !Number.isInteger(port) || port <= 1024 || port === 5432 || port > 65535
    || database !== DATABASE_NAME
    || decodeURIComponent(url.username) !== DATABASE_ROLE
    || [...url.searchParams.keys()].some((key) => key !== "schema")
    || (url.searchParams.has("schema") && url.searchParams.get("schema") !== "public")) {
    throw new Error("Refusing database target: expected the dedicated loopback pagination cluster and restricted test role.");
  }

  const ordinaryUrl = env.DATABASE_URL;
  if (ordinaryUrl) {
    try {
      const ordinary = new URL(ordinaryUrl);
      if (ordinary.hostname === url.hostname && ordinary.port === url.port
        && decodeURIComponent(ordinary.pathname.replace(/^\//, "")) === database) {
        throw new Error("The dedicated test target matches DATABASE_URL; refusing to connect.");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "The dedicated test target matches DATABASE_URL; refusing to connect.") throw error;
      // An unrelated or malformed ordinary URL is never used as a fallback.
    }
  }
  return url;
}

export async function verifyPaginationTestDatabase(client: Pick<PrismaClient, "$queryRaw">, url: URL) {
  const identities = await client.$queryRaw<Array<{
    databaseName: string;
    roleName: string;
    address: string | null;
    port: number;
    serverVersion: string;
    serverStartedAt: Date;
    isSuperuser: boolean;
    canCreateDatabase: boolean;
    canCreateRole: boolean;
    ownsCurrentDatabase: boolean;
    ordinaryDatabaseExists: boolean;
    canConnectOrdinaryDatabase: boolean;
    otherConnectibleDatabaseCount: number;
  }>>`
    SELECT
      current_database() AS "databaseName",
      current_user AS "roleName",
      inet_server_addr()::text AS address,
      inet_server_port() AS port,
      current_setting('server_version') AS "serverVersion",
      pg_postmaster_start_time() AS "serverStartedAt",
      r.rolsuper AS "isSuperuser",
      r.rolcreatedb AS "canCreateDatabase",
      r.rolcreaterole AS "canCreateRole",
      (d.datdba = r.oid) AS "ownsCurrentDatabase",
      EXISTS (SELECT 1 FROM pg_database ordinary WHERE ordinary.datname = 'bagati') AS "ordinaryDatabaseExists",
      COALESCE((SELECT has_database_privilege(current_user, ordinary.oid, 'CONNECT') FROM pg_database ordinary WHERE ordinary.datname = 'bagati'), false) AS "canConnectOrdinaryDatabase",
      (SELECT count(*)::int FROM pg_database otherDb
        WHERE otherDb.datname NOT IN (current_database(), 'template0')
        AND has_database_privilege(current_user, otherDb.oid, 'CONNECT')) AS "otherConnectibleDatabaseCount"
    FROM pg_roles r
    JOIN pg_database d ON d.datname = current_database()
    WHERE r.rolname = current_user
  `;
  const identity = identities[0];
  const failures: string[] = [];
  if (!identity) failures.push("identity row missing");
  if (identity && identity.databaseName !== DATABASE_NAME) failures.push("unexpected database name");
  if (identity && identity.roleName !== DATABASE_ROLE) failures.push("unexpected role name");
  const serverHost = identity?.address?.split("/")[0];
  if (identity && serverHost !== "127.0.0.1") failures.push(`unexpected server address (${identity.address ?? "null"})`);
  if (identity && identity.port !== Number(url.port)) failures.push("unexpected server port");
  if (identity?.isSuperuser) failures.push("role is superuser");
  if (identity?.canCreateDatabase) failures.push("role can create databases");
  if (identity?.canCreateRole) failures.push("role can create roles");
  if (identity && !identity.ownsCurrentDatabase) failures.push("role does not own test database");
  if (identity?.ordinaryDatabaseExists) failures.push("ordinary bagati database exists on this server");
  if (identity?.canConnectOrdinaryDatabase) failures.push("role can connect to ordinary bagati database");
  if (identity && identity.otherConnectibleDatabaseCount !== 0) failures.push("role can connect to another database");
  if (failures.length) {
    throw new Error(`Connected database identity preflight mismatch: ${failures.join("; ")}. Fixture operations are blocked.`);
  }
  return identity;
}
