CREATE TYPE "ImportJobStatus" AS ENUM (
    'UPLOADING',
    'QUEUED',
    'PROCESSING',
    'PAUSED',
    'COMPLETED',
    'COMPLETED_WITH_ERRORS',
    'FAILED',
    'CANCELLED'
);

CREATE TYPE "ImportJobRowStatus" AS ENUM (
    'PENDING',
    'CREATED',
    'UPDATED',
    'SKIPPED',
    'FAILED'
);

CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'UPLOADING',
    "sourceName" TEXT NOT NULL,
    "sourceFormat" TEXT NOT NULL,
    "sourceSizeBytes" BIGINT,
    "sourceChecksum" TEXT,
    "mode" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "chunkSize" INTEGER NOT NULL DEFAULT 50,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "createdRows" INTEGER NOT NULL DEFAULT 0,
    "updatedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImportJobRow" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "status" "ImportJobRowStatus" NOT NULL DEFAULT 'PENDING',
    "sourceData" JSONB NOT NULL,
    "normalizedSku" TEXT,
    "errors" JSONB,
    "warnings" JSONB,
    "productId" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ImportJobRow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImportJobSku" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "normalizedSku" TEXT NOT NULL,
    "firstRowNumber" INTEGER NOT NULL,
    CONSTRAINT "ImportJobSku_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImportJobRow_jobId_rowNumber_key" ON "ImportJobRow"("jobId", "rowNumber");
CREATE INDEX "ImportJobRow_jobId_status_rowNumber_idx" ON "ImportJobRow"("jobId", "status", "rowNumber");
CREATE INDEX "ImportJobRow_jobId_normalizedSku_idx" ON "ImportJobRow"("jobId", "normalizedSku");
CREATE UNIQUE INDEX "ImportJobSku_jobId_normalizedSku_key" ON "ImportJobSku"("jobId", "normalizedSku");
CREATE INDEX "ImportJobSku_jobId_firstRowNumber_idx" ON "ImportJobSku"("jobId", "firstRowNumber");
CREATE INDEX "ImportJob_storeId_createdAt_idx" ON "ImportJob"("storeId", "createdAt");
CREATE INDEX "ImportJob_storeId_status_createdAt_idx" ON "ImportJob"("storeId", "status", "createdAt");

ALTER TABLE "ImportJob"
    ADD CONSTRAINT "ImportJob_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportJob"
    ADD CONSTRAINT "ImportJob_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportJobRow"
    ADD CONSTRAINT "ImportJobRow_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportJobSku"
    ADD CONSTRAINT "ImportJobSku_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
