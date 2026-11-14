/**
 * Process-wide telemetry instance and its database writer. Server-only. The instance lives on globalThis so
 * development hot reloads do not start a second flush timer. Imports nothing that imports it back.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { utcTimestamp } from "@/lib/sql-timestamp";
import { createTelemetryStore, type MinuteRow, type TelemetryWriter } from "@/lib/security-monitoring/telemetry";
import { maybeRunMonitoringJobs } from "@/lib/security-monitoring/jobs";

/** One statement per flush: VALUES for every (minute, group) row; counters add up across processes. */
export const writeMinuteRows: TelemetryWriter = async (rows: MinuteRow[]) => {
  const values = rows.map((row) => Prisma.sql`(
    ${utcTimestamp(row.bucketStart)}, ${row.routeGroup}, ${row.requests}, ${row.status4xx}, ${row.status5xx}, ${row.authDenied},
    ${row.notFound}, ${row.rateLimited}, ${row.loginFailures}, ${row.ipMismatches}, ${BigInt(row.durationMsSum)}, ${row.durationMsMax}
  )`);
  await prisma.$executeRaw`
    INSERT INTO "SecurityMinuteStat" (
      "bucketStart", "routeGroup", "requests", "status4xx", "status5xx", "authDenied",
      "notFound", "rateLimited", "loginFailures", "ipMismatches", "durationMsSum", "durationMsMax"
    )
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("bucketStart", "routeGroup") DO UPDATE SET
      "requests" = "SecurityMinuteStat"."requests" + EXCLUDED."requests",
      "status4xx" = "SecurityMinuteStat"."status4xx" + EXCLUDED."status4xx",
      "status5xx" = "SecurityMinuteStat"."status5xx" + EXCLUDED."status5xx",
      "authDenied" = "SecurityMinuteStat"."authDenied" + EXCLUDED."authDenied",
      "notFound" = "SecurityMinuteStat"."notFound" + EXCLUDED."notFound",
      "rateLimited" = "SecurityMinuteStat"."rateLimited" + EXCLUDED."rateLimited",
      "loginFailures" = "SecurityMinuteStat"."loginFailures" + EXCLUDED."loginFailures",
      "ipMismatches" = "SecurityMinuteStat"."ipMismatches" + EXCLUDED."ipMismatches",
      "durationMsSum" = "SecurityMinuteStat"."durationMsSum" + EXCLUDED."durationMsSum",
      "durationMsMax" = GREATEST("SecurityMinuteStat"."durationMsMax", EXCLUDED."durationMsMax")`;
};

type TelemetryStore = ReturnType<typeof createTelemetryStore>;
const holder = globalThis as unknown as { __bagatiSecurityTelemetry?: TelemetryStore };

export const securityTelemetry: TelemetryStore = holder.__bagatiSecurityTelemetry
  ?? (holder.__bagatiSecurityTelemetry = createTelemetryStore({ write: writeMinuteRows, afterFlush: () => { void maybeRunMonitoringJobs(); } }));
