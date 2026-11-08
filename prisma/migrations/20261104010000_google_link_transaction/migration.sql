CREATE TABLE "GoogleLinkTransaction" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleSub" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoogleLinkTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleLinkTransaction_tokenHash_key" ON "GoogleLinkTransaction"("tokenHash");
CREATE INDEX "GoogleLinkTransaction_userId_usedAt_idx" ON "GoogleLinkTransaction"("userId", "usedAt");
CREATE INDEX "GoogleLinkTransaction_googleSub_idx" ON "GoogleLinkTransaction"("googleSub");
CREATE INDEX "GoogleLinkTransaction_expiresAt_idx" ON "GoogleLinkTransaction"("expiresAt");

ALTER TABLE "GoogleLinkTransaction"
ADD CONSTRAINT "GoogleLinkTransaction_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
