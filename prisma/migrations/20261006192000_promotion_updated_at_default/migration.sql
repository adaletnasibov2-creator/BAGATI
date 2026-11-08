-- Match the Prisma @updatedAt convention: clients write updatedAt, the database has no default.
ALTER TABLE "Promotion" ALTER COLUMN "updatedAt" DROP DEFAULT;
