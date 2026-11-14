-- CreateTable
CREATE TABLE "SellerVoenVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "voen" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "verifiedById" TEXT,
    "verifiedNote" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokedNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerVoenVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SellerVoenVerification_voen_idx" ON "SellerVoenVerification"("voen");

-- CreateIndex
CREATE UNIQUE INDEX "SellerVoenVerification_userId_voen_key" ON "SellerVoenVerification"("userId", "voen");

-- AddForeignKey
ALTER TABLE "SellerVoenVerification" ADD CONSTRAINT "SellerVoenVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerVoenVerification" ADD CONSTRAINT "SellerVoenVerification_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerVoenVerification" ADD CONSTRAINT "SellerVoenVerification_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Integrity (new table only, so it cannot fail on existing data): the lib/voen.ts format and the note limits.
ALTER TABLE "SellerVoenVerification" ADD CONSTRAINT "SellerVoenVerification_voen_format_check" CHECK ("voen" ~ '^[0-9]{9}[12]$');
ALTER TABLE "SellerVoenVerification" ADD CONSTRAINT "SellerVoenVerification_verified_note_check" CHECK (char_length("verifiedNote") BETWEEN 3 AND 300);
ALTER TABLE "SellerVoenVerification" ADD CONSTRAINT "SellerVoenVerification_revoked_note_check" CHECK ("revokedNote" IS NULL OR char_length("revokedNote") BETWEEN 3 AND 300);
ALTER TABLE "SellerVoenVerification" ADD CONSTRAINT "SellerVoenVerification_revoked_pair_check" CHECK (("revokedAt" IS NULL) = ("revokedNote" IS NULL));
