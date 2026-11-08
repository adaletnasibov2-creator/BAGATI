import { loadEnvFile } from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { z } from "zod";

const ownerEmail = "adaletnasibov2@gmail.com";
const passwordSchema = z.string().min(12).max(128);
type DependencyEntry = [name: string, count: number];
type ConversionResult =
  | { kind: "DEPENDENCIES"; dependencies: DependencyEntry[] }
  | { kind: "CREATED" };

async function main() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    loadEnvFile(resolve(projectRoot, ".env"));
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") {
      console.error("Operation stopped: the project .env file could not be loaded.");
      process.exitCode = 1;
      return;
    }
  }

  if (!process.env.DATABASE_URL) {
    console.error("Operation stopped: DATABASE_URL is not configured.");
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
      console.error("Operation stopped: DATABASE_URL must target the local PostgreSQL database named bagati.");
      process.exitCode = 1;
      return;
    }
  } catch {
    console.error("Operation stopped: DATABASE_URL is invalid; its value was not displayed.");
    process.exitCode = 1;
    return;
  }

  const parsedPassword = passwordSchema.safeParse(process.env.ADMIN_BOOTSTRAP_PASSWORD);
  if (!parsedPassword.success) {
    console.error("Operation stopped: set ADMIN_BOOTSTRAP_PASSWORD to a separate BAGATI password of 12–128 characters.");
    process.exitCode = 1;
    return;
  }

  let prisma: (typeof import("../lib/prisma"))["prisma"] | undefined;
  try {
    // Initialize Prisma only after the local project's environment is loaded.
    ({ prisma } = await import("../lib/prisma"));
    const { Prisma } = await import("@prisma/client");
    const passwordHash = await bcrypt.hash(parsedPassword.data, 12);

    const result: ConversionResult = await prisma.$transaction<ConversionResult>(async (tx) => {
      const account = await tx.user.findUnique({
        where: { email: ownerEmail },
        select: {
          id: true,
          role: true,
          isActive: true,
          vendorProfile: { select: { stores: { select: { id: true } } } },
          customerProfile: { select: { id: true } },
          addresses: { select: { id: true } },
          orders: { select: { id: true } },
          cart: { select: { items: { select: { id: true } } } },
          reviews: { select: { id: true } },
          notifications: { select: { id: true } },
          inventoryAdjustments: { select: { id: true } },
          supportTickets: { select: { id: true } },
          returnRequests: { select: { id: true } },
          auditLogs: { select: { id: true } },
        },
      });

      if (!account) throw new Error("TARGET_NOT_FOUND");
      if (account.role !== "VENDOR" || !account.isActive) throw new Error("TARGET_NOT_ACTIVE_VENDOR");
      if (await tx.user.count({ where: { role: "ADMIN" } })) throw new Error("ADMIN_ALREADY_EXISTS");

      const dependencies: Record<string, number> = {
        stores: account.vendorProfile?.stores.length ?? 0,
        customerProfiles: account.customerProfile ? 1 : 0,
        addresses: account.addresses.length,
        customerOrders: account.orders.length,
        cartItems: account.cart?.items.length ?? 0,
        reviews: account.reviews.length,
        notifications: account.notifications.length,
        inventoryAdjustments: account.inventoryAdjustments.length,
        supportTickets: account.supportTickets.length,
        returnRequests: account.returnRequests.length,
        auditLogs: account.auditLogs.length,
      };
      const existingDependencies = Object.keys(dependencies).reduce<DependencyEntry[]>(
        (entries, name) => {
          const count = dependencies[name];
          if (count > 0) entries.push([name, count]);
          return entries;
        },
        [],
      );
      if (existingDependencies.length) {
        return { kind: "DEPENDENCIES", dependencies: existingDependencies } as const;
      }

      // User deletion cascades only the empty vendor profile and verification
      // record confirmed by the checks above. The transaction rolls back both
      // operations if the replacement account cannot be created.
      await tx.user.delete({ where: { id: account.id } });
      await tx.user.create({
        data: {
          email: ownerEmail,
          passwordHash,
          role: "ADMIN",
          isActive: true,
        },
        select: { id: true },
      });
      return { kind: "CREATED" } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (result.kind === "DEPENDENCIES") {
      console.error(`Operation stopped; no records changed. Existing related records: ${result.dependencies.map(([name, count]) => `${name}=${count}`).join(", ")}.`);
      process.exitCode = 1;
      return;
    }
    console.log("Owner ADMIN account created. Sign in at /admin/login.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "TARGET_NOT_FOUND") console.error("Operation stopped: the target account was not found.");
    else if (message === "TARGET_NOT_ACTIVE_VENDOR") console.error("Operation stopped: the target must be an active VENDOR account.");
    else if (message === "ADMIN_ALREADY_EXISTS") console.error("Operation stopped: an ADMIN account already exists; no account was changed.");
    else {
      const rawCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
      const code = typeof rawCode === "string" && /^(P\d{4}|E[A-Z0-9_]{1,24})$/.test(rawCode) ? rawCode : "unclassified";
      console.error(`Operation failed safely (${code}); no credentials or raw database details were logged.`);
    }
    process.exitCode = 1;
  } finally {
    delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
    if (prisma) await prisma.$disconnect();
  }
}

void main().catch(() => {
  console.error("Operation could not be started; no credentials were logged.");
  process.exitCode = 1;
});
