import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTemporaryPostgresListenerIdentity,
  assertTemporaryPostgresRoot,
} from "./pagination-postgres-listener-identity.mjs";

const paths = {
  tempRoot: "C:\\Users\\Runner\\AppData\\Local\\Temp",
  runDirectory: "C:\\Users\\Runner\\AppData\\Local\\Temp\\bagati-pagination-pg-a1b2",
  dataDirectory: "C:\\Users\\Runner\\AppData\\Local\\Temp\\bagati-pagination-pg-a1b2\\data",
};

test("accepts the listener only when it reports this run's exact temporary data directory", () => {
  assert.equal(assertTemporaryPostgresListenerIdentity({
    ...paths,
    reportedDataDirectory: "c:/users/runner/AppData/Local/Temp/bagati-pagination-pg-a1b2/data/.",
  }), true);
});

test("rejects a reused port whose listener belongs to the Windows PostgreSQL service", () => {
  assert.throws(() => assertTemporaryPostgresListenerIdentity({
    ...paths,
    reportedDataDirectory: "C:\\Program Files\\PostgreSQL\\18\\data",
  }), /does not match the spawned temporary cluster/);
});

test("rejects a temporary run directory nested inside the protected service data directory", () => {
  assert.throws(() => assertTemporaryPostgresListenerIdentity({
    tempRoot: "C:\\Program Files\\PostgreSQL\\18\\data\\tmp",
    runDirectory: "C:\\Program Files\\PostgreSQL\\18\\data\\tmp\\bagati-pagination-pg-a1b2",
    dataDirectory: "C:\\Program Files\\PostgreSQL\\18\\data\\tmp\\bagati-pagination-pg-a1b2\\data",
    reportedDataDirectory: "C:\\Program Files\\PostgreSQL\\18\\data\\tmp\\bagati-pagination-pg-a1b2\\data",
  }), /overlaps the protected Windows service data directory/);
});

test("rejects a temp root overlapping the protected service data directory before creating a cluster", () => {
  assert.throws(() => assertTemporaryPostgresRoot({
    tempRoot: "C:\\Program Files\\PostgreSQL\\18\\data\\runner-temp",
  }), /overlaps the protected Windows service data directory/);
});

test("rejects a listener reporting any other data directory before setup SQL", () => {
  assert.throws(() => assertTemporaryPostgresListenerIdentity({
    ...paths,
    reportedDataDirectory: "C:\\temp\\another-postgres-instance\\data",
  }), /does not match the spawned temporary cluster/);
});
