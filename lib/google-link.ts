import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { Prisma, type Role } from "@prisma/client";
import { safeOAuthNextPath } from "@/lib/google-oauth";
import { prisma } from "@/lib/prisma";

export const GOOGLE_LINK_COOKIE = "bagati_google_link";
export const GOOGLE_LINK_NEXT_COOKIE = "bagati_google_link_next";
export const GOOGLE_LINK_TTL_MS = 10 * 60 * 1000;

export type GoogleLinkResult = "linked" | "expired" | "reused" | "mismatch" | "conflict" | "invalid";

export function hashGoogleLinkToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function googleLinkCookieOptions(maxAge = GOOGLE_LINK_TTL_MS / 1000) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
    ...(maxAge <= 0 ? { expires: new Date(0) } : {}),
  };
}

export function expiredGoogleLinkCookie() {
  return { name: GOOGLE_LINK_COOKIE, value: "", ...googleLinkCookieOptions(0) };
}

export function expiredGoogleLinkNextCookie() {
  return { name: GOOGLE_LINK_NEXT_COOKIE, value: "", ...googleLinkCookieOptions(0) };
}

export function googleLinkDestination(role: Role, requested?: string | null) {
  if (role === "VENDOR") return safeOAuthNextPath(requested, "vendor");
  if (role === "CUSTOMER") return safeOAuthNextPath(requested, "customer");
  return "/login";
}

function emailHint(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "";
  return `${local.slice(0, 1)}***@${domain}`;
}

export type GoogleLinkChallenge =
  | { status: "ready"; role: "CUSTOMER" | "VENDOR"; emailHint: string; destination: string }
  | { status: "expired" | "reused" | "invalid" | "unavailable" | "inactive" };

/** Reads the server-side transaction. The browser never supplies the account id. */
export async function readGoogleLinkChallenge(token: string | undefined): Promise<GoogleLinkChallenge> {
  if (!token) return { status: "invalid" };
  try {
    const row = await prisma.googleLinkTransaction.findUnique({
      where: { tokenHash: hashGoogleLinkToken(token) },
      select: { userId: true, email: true, expiresAt: true, usedAt: true },
    });
    if (!row) return { status: "invalid" };
    if (row.usedAt) return { status: "reused" };
    if (row.expiresAt.getTime() <= Date.now()) return { status: "expired" };
    const user = await prisma.user.findUnique({
      where: { id: row.userId },
      select: { role: true, isActive: true, email: true, passwordAuthEnabled: true },
    });
    if (!user?.isActive || !user.passwordAuthEnabled || !isGoogleLinkableRole(user.role) || user.email.trim().toLowerCase() !== row.email) {
      return { status: "inactive" };
    }
    return {
      status: "ready",
      role: user.role,
      emailHint: emailHint(row.email),
      destination: googleLinkDestination(user.role),
    };
  } catch (error) {
    if (isMissingGoogleLinkStore(error)) return { status: "unavailable" };
    throw error;
  }
}

/** Keeps the raw linking token out of the page module so it is not serialized to the browser. */
export async function readCurrentGoogleLinkChallenge() {
  const cookieStore = await cookies();
  return readGoogleLinkChallenge(cookieStore.get(GOOGLE_LINK_COOKIE)?.value);
}

export function isGoogleLinkableRole(role: Role) {
  return role === "CUSTOMER" || role === "VENDOR";
}

export function isMissingGoogleLinkStore(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2021" || error.code === "P2022");
}

/** Stores only a hash of the browser token. The matched user id comes from the server-side email lookup. */
export async function createGoogleLinkTransaction(input: { userId: string; googleSub: string; email: string }) {
  const token = randomBytes(32).toString("base64url");
  const email = input.email.trim().toLowerCase();
  const now = new Date();
  await prisma.$transaction([
    prisma.googleLinkTransaction.updateMany({
      where: { userId: input.userId, usedAt: null },
      data: { usedAt: now },
    }),
    prisma.googleLinkTransaction.create({
      data: {
        tokenHash: hashGoogleLinkToken(token),
        userId: input.userId,
        googleSub: input.googleSub,
        email,
        expiresAt: new Date(now.getTime() + GOOGLE_LINK_TTL_MS),
      },
    }),
  ]);
  return token;
}

/**
 * Completes a pending link only when the authenticated account is the exact server-side match.
 * A mismatched login does not consume the transaction. A successful or conflicting attempt does.
 */
export async function consumeGoogleLink(token: string | undefined, account: { id: string; email: string; role: Role }): Promise<GoogleLinkResult | null> {
  if (!token) return null;
  const row = await prisma.googleLinkTransaction.findUnique({ where: { tokenHash: hashGoogleLinkToken(token) } });
  if (!row) return "invalid";
  if (row.usedAt) return "reused";
  if (row.expiresAt.getTime() <= Date.now()) return "expired";
  const sameAccount = row.userId === account.id && row.email === account.email.trim().toLowerCase() && isGoogleLinkableRole(account.role);
  if (!sameAccount) return "mismatch";

  let outcome: "linked" | "reused" | "conflict" = "linked";
  await prisma.$transaction(async (transaction) => {
    const consumed = await transaction.googleLinkTransaction.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() }, userId: account.id },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) {
      outcome = "reused";
      return;
    }
    const [subOwner, userOwner] = await Promise.all([
      transaction.googleAccount.findUnique({ where: { googleSub: row.googleSub }, select: { userId: true } }),
      transaction.googleAccount.findUnique({ where: { userId: account.id }, select: { googleSub: true } }),
    ]);
    if ((subOwner && subOwner.userId !== account.id) || (userOwner && userOwner.googleSub !== row.googleSub)) {
      outcome = "conflict";
      return;
    }
    if (!userOwner) await transaction.googleAccount.create({ data: { googleSub: row.googleSub, userId: account.id } });
  });
  return outcome;
}

export async function applyGoogleLink(request: { cookies: { get(name: string): { value: string } | undefined } }, account: { id: string; email: string; role: Role }) {
  try {
    const result = await consumeGoogleLink(request.cookies.get(GOOGLE_LINK_COOKIE)?.value, account);
    return { result, clearCookie: result !== null && result !== "mismatch" };
  } catch (error) {
    if (isMissingGoogleLinkStore(error)) return { result: null, clearCookie: false };
    throw error;
  }
}

export async function unlinkGoogleAccount(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, role: true, passwordAuthEnabled: true },
  });
  if (!user?.isActive || !isGoogleLinkableRole(user.role)) return "forbidden" as const;
  if (!user.passwordAuthEnabled) return "password-required" as const;
  await prisma.googleAccount.deleteMany({ where: { userId } });
  return "unlinked" as const;
}
