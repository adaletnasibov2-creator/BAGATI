-- CreateTable
CREATE TABLE "EmailWorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "heartbeatAt" TIMESTAMP(3) NOT NULL,
    "lastPollStartedAt" TIMESTAMP(3),
    "lastPollCompletedAt" TIMESTAMP(3),
    "lastSuccessfulPollAt" TIMESTAMP(3),
    "lastPollErrorCode" TEXT,
    "lastPollErrorType" TEXT,
    "lastPollProcessed" INTEGER,
    "lastPollSent" INTEGER,
    "lastPollFailed" INTEGER,
    "stoppedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailWorkerHeartbeat_pkey" PRIMARY KEY ("id")
);
