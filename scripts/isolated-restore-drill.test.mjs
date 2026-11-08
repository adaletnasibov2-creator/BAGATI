import assert from "node:assert/strict";
import test from "node:test";
import { isolatedRestoreTargets } from "./isolated-restore-drill.mjs";

const local = "postgresql://bagati_user:bagati_password@localhost:5432/bagati?schema=public";

test("restore drill derives only allowlisted local databases", () => {
  const targets = isolatedRestoreTargets(local);
  assert.equal(new URL(targets.adminUrl).pathname, "/postgres");
  assert.equal(new URL(targets.drillUrl).pathname, "/bagati_restore_drill");
  assert.equal(new URL(targets.copyUrl).pathname, "/bagati_restore_verify");
  assert.equal(targets.drillName, "bagati_restore_drill");
});

test("restore drill refuses remote, production-named, and non-development databases", () => {
  assert.throws(() => isolatedRestoreTargets("postgresql://u:p@db.example.test:5432/bagati"), /local PostgreSQL/);
  assert.throws(() => isolatedRestoreTargets("postgresql://u:p@localhost:5432/bagati_staging"), /local development database/);
  assert.throws(() => isolatedRestoreTargets("postgresql://u:p@127.0.0.1:5433/bagati"), /port 5432/);
  assert.throws(() => isolatedRestoreTargets("mysql://u:p@localhost:5432/bagati"), /PostgreSQL/);
});
