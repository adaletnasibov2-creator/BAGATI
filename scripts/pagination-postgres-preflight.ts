import { PrismaClient } from "@prisma/client";
import { requirePaginationTestUrl, verifyPaginationTestDatabase } from "./pagination-postgres-safety";

async function main() {
  const url = requirePaginationTestUrl();
  const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
    const identity = await verifyPaginationTestDatabase(prisma, url);
    console.log(`Isolated PostgreSQL preflight passed: db=${identity.databaseName}, role=${identity.roleName}, host=${identity.address}, port=${identity.port}, PostgreSQL=${identity.serverVersion}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? ` (Prisma ${error.code})` : "";
  const safeMismatch = error instanceof Error && error.message.startsWith("Connected database identity preflight mismatch:")
    ? ` ${error.message}`
    : " Details and connection settings were suppressed.";
  console.error(`PostgreSQL pagination preflight failed${code}.${safeMismatch}`);
  process.exitCode = 1;
});
