-- CreateEnum
CREATE TYPE "ConversationContext" AS ENUM ('PRODUCT', 'ORDER', 'STORE');

-- CreateEnum
CREATE TYPE "MessageSenderRole" AS ENUM ('CUSTOMER', 'STORE');

-- CreateEnum
CREATE TYPE "ConversationBlockSide" AS ENUM ('CUSTOMER', 'STORE');

-- CreateEnum
CREATE TYPE "ConversationReportStatus" AS ENUM ('OPEN', 'REVIEWED', 'DISMISSED');

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "customerId" TEXT,
    "context" "ConversationContext" NOT NULL,
    "contextKey" VARCHAR(80) NOT NULL,
    "productId" TEXT,
    "storeOrderId" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessagePreview" VARCHAR(140) NOT NULL,
    "lastSenderRole" "MessageSenderRole" NOT NULL,
    "customerUnreadCount" INTEGER NOT NULL DEFAULT 0,
    "storeUnreadCount" INTEGER NOT NULL DEFAULT 0,
    "customerLastReadAt" TIMESTAMP(3),
    "storeLastReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderRole" "MessageSenderRole" NOT NULL,
    "senderUserId" TEXT,
    "body" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationBlock" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "side" "ConversationBlockSide" NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationReport" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "reporterUserId" TEXT,
    "reporterRole" "MessageSenderRole" NOT NULL,
    "reason" VARCHAR(20) NOT NULL,
    "note" VARCHAR(500),
    "status" "ConversationReportStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Conversation_storeId_lastMessageAt_id_idx" ON "Conversation"("storeId", "lastMessageAt" DESC, "id");

-- CreateIndex
CREATE INDEX "Conversation_customerId_lastMessageAt_id_idx" ON "Conversation"("customerId", "lastMessageAt" DESC, "id");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_customerId_storeId_contextKey_key" ON "Conversation"("customerId", "storeId", "contextKey");

-- CreateIndex
CREATE INDEX "ConversationMessage_conversationId_createdAt_id_idx" ON "ConversationMessage"("conversationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationBlock_storeId_customerId_side_key" ON "ConversationBlock"("storeId", "customerId", "side");

-- CreateIndex
CREATE INDEX "ConversationReport_status_createdAt_idx" ON "ConversationReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationReport_conversationId_idx" ON "ConversationReport"("conversationId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_storeOrderId_fkey" FOREIGN KEY ("storeOrderId") REFERENCES "StoreOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationBlock" ADD CONSTRAINT "ConversationBlock_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationBlock" ADD CONSTRAINT "ConversationBlock_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationReport" ADD CONSTRAINT "ConversationReport_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationReport" ADD CONSTRAINT "ConversationReport_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationReport" ADD CONSTRAINT "ConversationReport_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Not expressible in the Prisma schema (keep in sync with lib/messaging.ts and lib/messaging-service.ts).
-- Unread badges: only conversations with something unread are indexed for each side.
CREATE INDEX "Conversation_store_unread_idx" ON "Conversation"("storeId") WHERE "storeUnreadCount" > 0;
CREATE INDEX "Conversation_customer_unread_idx" ON "Conversation"("customerId") WHERE "customerUnreadCount" > 0;

-- Counters never go below zero; a context row matches its context.
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_unread_counts_check"
  CHECK ("customerUnreadCount" >= 0 AND "storeUnreadCount" >= 0);
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_context_check"
  CHECK (
    ("context" = 'STORE' AND "contextKey" = 'store')
    OR ("context" = 'PRODUCT' AND "contextKey" LIKE 'product:%')
    OR ("context" = 'ORDER' AND "contextKey" LIKE 'order:%')
  );

-- Message length 1-1000 characters (VARCHAR(1000) already caps the upper bound).
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_body_length_check"
  CHECK (char_length("body") BETWEEN 1 AND 1000);
