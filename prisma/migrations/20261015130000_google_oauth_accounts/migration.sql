CREATE TABLE "GoogleAccount" (
    "id" TEXT NOT NULL,
    "googleSub" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoogleAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleAccount_googleSub_key" ON "GoogleAccount"("googleSub");
CREATE UNIQUE INDEX "GoogleAccount_userId_key" ON "GoogleAccount"("userId");
ALTER TABLE "GoogleAccount"
ADD CONSTRAINT "GoogleAccount_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
