import { loadEnvFile } from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { z } from "zod";

const credentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
});

async function main() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    // Load the project's .env before importing Prisma. Existing process
    // variables take precedence, so the one-time prompt values remain intact.
    loadEnvFile(resolve(projectRoot, ".env"));
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") {
      console.error("Bootstrap stopped: the project .env file could not be loaded safely.");
      process.exitCode = 1;
      return;
    }
  }

  const parsed = credentialsSchema.safeParse({
    email: process.env.ADMIN_BOOTSTRAP_EMAIL,
    password: process.env.ADMIN_BOOTSTRAP_PASSWORD,
  });
  if (!parsed.success) {
    console.error("Bootstrap stopped: set ADMIN_BOOTSTRAP_EMAIL to a valid email and ADMIN_BOOTSTRAP_PASSWORD to 12–128 characters.");
    process.exitCode = 1;
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error("Bootstrap stopped: DATABASE_URL is not configured.");
    process.exitCode = 1;
    return;
  }
  try {
    const databaseUrl = new URL(process.env.DATABASE_URL);
    const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ""));
    const databaseHost = databaseUrl.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      !["postgres:", "postgresql:"].includes(databaseUrl.protocol) ||
      databaseName !== "bagati" ||
      !["localhost", "127.0.0.1", "::1"].includes(databaseHost)
    ) {
      console.error("Bootstrap stopped: DATABASE_URL must target the local PostgreSQL database named bagati.");
      process.exitCode = 1;
      return;
    }
  } catch {
    console.error("Bootstrap stopped: DATABASE_URL is invalid; its value was not displayed.");
    process.exitCode = 1;
    return;
  }

  let prisma: (typeof import("../lib/prisma"))["prisma"] | undefined;
  try {
    // Deliberately initialize Prisma only after loadEnvFile has populated the
    // database configuration.
    ({ prisma } = await import("../lib/prisma"));
    const { Prisma } = await import("@prisma/client");
    const email = parsed.data.email.toLowerCase();
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);

    await prisma.$transaction(async (tx) => {
      if (await tx.user.count({ where: { role: "ADMIN" } })) {
        throw new Error("BOOTSTRAP_ALREADY_USED");
      }
      if (await tx.user.findUnique({ where: { email }, select: { id: true } })) {
        throw new Error("EMAIL_ALREADY_REGISTERED");
      }

      await tx.user.create({
        data: {
          email,
          passwordHash,
          role: "ADMIN",
          isActive: true,
        },
        select: { id: true },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    console.log("Owner ADMIN account created. Sign in at /admin/login.");
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "BOOTSTRAP_ALREADY_USED") {
      console.error("Bootstrap stopped: an ADMIN account already exists; use the existing account's password reset process.");
    } else if (code === "EMAIL_ALREADY_REGISTERED") {
      console.error("Bootstrap stopped: this email already belongs to an account. No account was changed.");
    } else {
      // Only allow safe error class/code metadata. Prisma messages can include
      // connection details, so never print the raw error or its message.
      const errorName = error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name)
        ? error.name
        : "UnknownError";
      const rawCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
      const safeCode = typeof rawCode === "string" && /^(P\d{4}|E[A-Z0-9_]{1,24})$/.test(rawCode)
        ? rawCode
        : "unclassified";
      const nextStep: Record<string, string> = {
        P1000: "Database authentication failed; check the local database configuration.",
        P1001: "Database host is unreachable; check that PostgreSQL is running and reachable.",
        P1002: "Database connection timed out; check PostgreSQL availability.",
        P1003: "The configured database was not found.",
        P2002: "A unique database value conflicts with an existing record.",
        P2034: "A concurrent bootstrap transaction conflicted; retry the command once.",
        P2021: "A required database table is missing; verify migrations before retrying.",
        ENOENT: "A required local file could not be found.",
        ECONNREFUSED: "The database refused the connection; check that PostgreSQL is running.",
        ETIMEDOUT: "The database connection timed out.",
        ENOTFOUND: "The database host could not be resolved.",
      };
      console.error(`Bootstrap failed safely (${errorName}, ${safeCode}). ${nextStep[safeCode] || "Inspect local Prisma/database setup; credentials and raw error details were not logged."}`);
    }
    process.exitCode = 1;
  } finally {
    delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
    delete process.env.ADMIN_BOOTSTRAP_EMAIL;
    if (prisma) await prisma.$disconnect();
  }
}

void main();
