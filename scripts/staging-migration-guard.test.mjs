import assert from "node:assert/strict";
import test from "node:test";
import { validateStagingMigrationTarget } from "./migrate-staging.mjs";

const validEnv = {
  BAGATI_ENV: "staging",
  BAGATI_STAGING_CONFIRM: "bagati-staging",
  BAGATI_STAGING_DATABASE_HOST: "dpg-example.oregon-postgres.render.com",
  DATABASE_URL: "postgresql://stage_user:stage_password@dpg-example.oregon-postgres.render.com:5432/bagati_staging?schema=public",
};

test("staging migration guard accepts only explicitly confirmed staging database", () => {
  assert.deepEqual(validateStagingMigrationTarget(validEnv), { database: "bagati_staging" });
});

test("staging migration guard rejects the main database name", () => {
  assert.throws(
    () => validateStagingMigrationTarget({ ...validEnv, DATABASE_URL: "postgresql://u:p@dpg-example.oregon-postgres.render.com:5432/bagati?schema=public" }),
    /database name must be exactly bagati_staging/,
  );
});

test("staging migration guard rejects missing environment and confirmation", () => {
  assert.throws(() => validateStagingMigrationTarget({ ...validEnv, BAGATI_ENV: "production" }), /BAGATI_ENV must be staging/);
  assert.throws(() => validateStagingMigrationTarget({ ...validEnv, BAGATI_STAGING_CONFIRM: "" }), /BAGATI_STAGING_CONFIRM/);
  assert.throws(() => validateStagingMigrationTarget({ ...validEnv, BAGATI_STAGING_DATABASE_HOST: "" }), /BAGATI_STAGING_DATABASE_HOST/);
});

test("staging migration guard rejects local, mismatched, malformed, and non-PostgreSQL targets", () => {
  assert.throws(
    () => validateStagingMigrationTarget({ ...validEnv, DATABASE_URL: "postgresql://u:p@localhost:5432/bagati_staging" }),
    /remote staging database is required/,
  );
  assert.throws(
    () => validateStagingMigrationTarget({ ...validEnv, DATABASE_URL: "mysql://u:p@db.example.test:3306/bagati_staging" }),
    /must use PostgreSQL/,
  );
  assert.throws(
    () => validateStagingMigrationTarget({ ...validEnv, DATABASE_URL: "postgresql://u:p@different.example.test:5432/bagati_staging" }),
    /host does not match/,
  );
  assert.throws(() => validateStagingMigrationTarget({ ...validEnv, DATABASE_URL: "not-a-url" }), /not a valid URL/);
});
