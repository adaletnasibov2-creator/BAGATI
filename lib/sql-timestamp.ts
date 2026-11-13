import { Prisma } from "@prisma/client";

/**
 * A JS Date as a UTC `timestamp without time zone` SQL value, for comparisons against Prisma `DateTime` columns in
 * raw SQL.
 *
 * Prisma stores DateTime as `timestamp(3)` (no zone) holding UTC wall-clock values, but binds a Date parameter in
 * `$queryRaw` as `timestamptz`. Comparing the two makes PostgreSQL convert the column with the session TimeZone, so
 * on a server whose TimeZone is not UTC (the verify cluster runs with Asia/Baku) every bound shifts by the offset.
 * Converting the parameter to UTC wall-clock time keeps the comparison exact under any TimeZone setting; the result
 * is a constant, so index range scans still apply.
 */
export function utcTimestamp(date: Date): Prisma.Sql {
  return Prisma.sql`(${date}::timestamptz AT TIME ZONE 'UTC')`;
}
