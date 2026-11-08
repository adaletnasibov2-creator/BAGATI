CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "sourceEventId" VARCHAR(128) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "sourceIp" VARCHAR(45),
    "path" VARCHAR(500),
    "eventType" VARCHAR(64) NOT NULL,
    "severity" VARCHAR(16) NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "ruleId" VARCHAR(128),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SecurityEvent_source_sourceEventId_key" ON "SecurityEvent"("source", "sourceEventId");
CREATE INDEX "SecurityEvent_occurredAt_idx" ON "SecurityEvent"("occurredAt");
CREATE INDEX "SecurityEvent_source_occurredAt_idx" ON "SecurityEvent"("source", "occurredAt");
CREATE INDEX "SecurityEvent_eventType_occurredAt_idx" ON "SecurityEvent"("eventType", "occurredAt");
CREATE INDEX "SecurityEvent_severity_occurredAt_idx" ON "SecurityEvent"("severity", "occurredAt");
CREATE INDEX "SecurityEvent_sourceIp_occurredAt_idx" ON "SecurityEvent"("sourceIp", "occurredAt");
