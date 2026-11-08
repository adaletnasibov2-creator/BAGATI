import { loadEnvFile } from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

async function main() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  loadEnvFile(resolve(projectRoot, ".env"));

  const { prisma } = await import("../lib/prisma");
  try {
    const user = await prisma.user.findUnique({
      where: { email: "adaletnasibov2@gmail.com" },
      select: { role: true, isActive: true },
    });

    console.log(user ? JSON.stringify(user) : "NOT_FOUND");
  } catch {
    console.error("Account lookup failed.");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(() => {
  console.error("Account lookup could not be started.");
  process.exitCode = 1;
});
