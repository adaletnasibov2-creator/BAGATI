-- Security Center phase 1 (in-app live monitoring). Additive: five new tables, one enum and one nullable column
-- on SecurityEvent (sourceIpMasked). No existing column, row, constraint or index is changed or removed.
-- No seed rows: alert rules use their code defaults until an admin saves an override.

-- CreateEnum
CREATE TYPE "SecurityIncidentStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE');

-- AlterTable
ALTER TABLE "SecurityEvent" ADD COLUMN     "sourceIpMasked" VARCHAR(64);

-- CreateTable
CREATE TABLE "SecurityMinuteStat" (
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "routeGroup" VARCHAR(48) NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "status4xx" INTEGER NOT NULL DEFAULT 0,
    "status5xx" INTEGER NOT NULL DEFAULT 0,
    "authDenied" INTEGER NOT NULL DEFAULT 0,
    "notFound" INTEGER NOT NULL DEFAULT 0,
    "rateLimited" INTEGER NOT NULL DEFAULT 0,
    "loginFailures" INTEGER NOT NULL DEFAULT 0,
    "ipMismatches" INTEGER NOT NULL DEFAULT 0,
    "durationMsSum" BIGINT NOT NULL DEFAULT 0,
    "durationMsMax" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SecurityMinuteStat_pkey" PRIMARY KEY ("bucketStart","routeGroup")
);

-- CreateTable
CREATE TABLE "SecurityHourStat" (
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "routeGroup" VARCHAR(48) NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "status4xx" INTEGER NOT NULL DEFAULT 0,
    "status5xx" INTEGER NOT NULL DEFAULT 0,
    "authDenied" INTEGER NOT NULL DEFAULT 0,
    "notFound" INTEGER NOT NULL DEFAULT 0,
    "rateLimited" INTEGER NOT NULL DEFAULT 0,
    "loginFailures" INTEGER NOT NULL DEFAULT 0,
    "ipMismatches" INTEGER NOT NULL DEFAULT 0,
    "durationMsSum" BIGINT NOT NULL DEFAULT 0,
    "durationMsMax" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SecurityHourStat_pkey" PRIMARY KEY ("bucketStart","routeGroup")
);

-- CreateTable
CREATE TABLE "SecurityAlertRule" (
    "key" VARCHAR(48) NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "threshold" INTEGER NOT NULL,
    "windowMinutes" INTEGER NOT NULL,
    "cooldownMinutes" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityAlertRule_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SecurityIncident" (
    "id" TEXT NOT NULL,
    "ruleKey" VARCHAR(48) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "severity" VARCHAR(16) NOT NULL,
    "status" "SecurityIncidentStatus" NOT NULL DEFAULT 'OPEN',
    "observedValue" INTEGER NOT NULL,
    "threshold" INTEGER NOT NULL,
    "windowMinutes" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "assigneeId" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityIncidentNote" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityIncidentNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SecurityMinuteStat_bucketStart_idx" ON "SecurityMinuteStat"("bucketStart");

-- CreateIndex
CREATE INDEX "SecurityHourStat_bucketStart_idx" ON "SecurityHourStat"("bucketStart");

-- CreateIndex
CREATE INDEX "SecurityIncident_status_createdAt_idx" ON "SecurityIncident"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityIncident_ruleKey_createdAt_idx" ON "SecurityIncident"("ruleKey", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityIncidentNote_incidentId_createdAt_idx" ON "SecurityIncidentNote"("incidentId", "createdAt");

-- AddForeignKey
ALTER TABLE "SecurityAlertRule" ADD CONSTRAINT "SecurityAlertRule_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityIncident" ADD CONSTRAINT "SecurityIncident_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityIncident" ADD CONSTRAINT "SecurityIncident_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityIncident" ADD CONSTRAINT "SecurityIncident_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityIncidentNote" ADD CONSTRAINT "SecurityIncidentNote_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "SecurityIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityIncidentNote" ADD CONSTRAINT "SecurityIncidentNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CHECK constraints (not modelled by Prisma; "prisma migrate diff" ignores them).
ALTER TABLE "SecurityMinuteStat" ADD CONSTRAINT "SecurityMinuteStat_values_check" CHECK (
  "routeGroup" ~ '^[a-z0-9][a-z0-9._:-]{0,47}$'
  AND "requests" >= 0 AND "status4xx" >= 0 AND "status5xx" >= 0 AND "authDenied" >= 0 AND "notFound" >= 0
  AND "rateLimited" >= 0 AND "loginFailures" >= 0 AND "ipMismatches" >= 0 AND "durationMsSum" >= 0 AND "durationMsMax" >= 0
);
ALTER TABLE "SecurityHourStat" ADD CONSTRAINT "SecurityHourStat_values_check" CHECK (
  "routeGroup" ~ '^[a-z0-9][a-z0-9._:-]{0,47}$'
  AND "requests" >= 0 AND "status4xx" >= 0 AND "status5xx" >= 0 AND "authDenied" >= 0 AND "notFound" >= 0
  AND "rateLimited" >= 0 AND "loginFailures" >= 0 AND "ipMismatches" >= 0 AND "durationMsSum" >= 0 AND "durationMsMax" >= 0
);
ALTER TABLE "SecurityAlertRule" ADD CONSTRAINT "SecurityAlertRule_values_check" CHECK (
  "key" ~ '^[a-z][a-z0-9_]{1,47}$'
  AND "threshold" BETWEEN 1 AND 100000
  AND "windowMinutes" BETWEEN 1 AND 1440
  AND "cooldownMinutes" BETWEEN 1 AND 10080
  AND "version" >= 1
);
ALTER TABLE "SecurityIncident" ADD CONSTRAINT "SecurityIncident_values_check" CHECK (
  char_length(btrim("title")) > 0
  AND "severity" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
  AND "observedValue" >= 0 AND "threshold" >= 1 AND "windowMinutes" >= 1
  AND "windowEnd" >= "windowStart"
  AND ("status" NOT IN ('RESOLVED', 'FALSE_POSITIVE') OR "resolvedAt" IS NOT NULL)
);
ALTER TABLE "SecurityIncidentNote" ADD CONSTRAINT "SecurityIncidentNote_body_check" CHECK (
  char_length(btrim("body")) > 0 AND char_length("body") <= 2000
);
