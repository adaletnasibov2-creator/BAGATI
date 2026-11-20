import { NextRequest, NextResponse } from "next/server";
import { requireStoreAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { authRateLimitKey, consumeAuthRateLimit } from "@/lib/auth-rate-limit";
import { readJsonBodyLimited } from "@/lib/request-json";
import {
  normalizeNotificationEmail, notificationEmailStatus, NOTIFICATION_EMAIL_SEND_LIMIT,
  removeNotificationEmail, resendNotificationEmail, saveNotificationEmail,
} from "@/lib/store-notification-email";

/**
 * The store's optional extra notification email (SELLER-ALERTS, part B). Only the store's own seller.
 * GET status · PUT { email } save (unverified + link) · POST resend the link · DELETE remove.
 * Links are limited to 3 per hour per store. State-changing calls pass the shared CSRF check in middleware.
 */
export const dynamic = "force-dynamic";

const MESSAGES = {
  invalid: "E-poçt ünvanını düzgün daxil edin.",
  rateLimited: "Çox sayda sorğu göndərildi. Bir az sonra yenidən cəhd edin.",
  unavailable: "Əməliyyatı indi tamamlamaq mümkün olmadı. Bir az sonra yenidən cəhd edin.",
};
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function sellerStore(storeId: string) {
  const access = await requireStoreAccess(storeId);
  return access?.user.role === "VENDOR" ? access : null;
}

async function withinSendLimit(storeId: string) {
  return consumeAuthRateLimit(authRateLimitKey("store-notification-email", storeId), NOTIFICATION_EMAIL_SEND_LIMIT.limit, NOTIFICATION_EMAIL_SEND_LIMIT.windowMs);
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const access = await sellerStore(storeId);
  if (!access) return json({ error: "Not found" }, 404);
  const store = await prisma.store.findUniqueOrThrow({ where: { id: access.storeId }, select: { notificationEmail: true, notificationEmailVerifiedAt: true } });
  return json(notificationEmailStatus(store));
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const access = await sellerStore(storeId);
  if (!access) return json({ error: "Not found" }, 404);
  const body = await readJsonBodyLimited(request, 2048);
  const email = body.ok ? normalizeNotificationEmail((body.value as { email?: unknown } | null)?.email) : null;
  if (!email) return json({ error: MESSAGES.invalid }, 422);
  if (!(await withinSendLimit(access.storeId))) return json({ error: MESSAGES.rateLimited }, 429);
  try {
    return json(await saveNotificationEmail(prisma, { storeId: access.storeId, email }));
  } catch {
    return json({ error: MESSAGES.unavailable }, 500);
  }
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const access = await sellerStore(storeId);
  if (!access) return json({ error: "Not found" }, 404);
  if (!(await withinSendLimit(access.storeId))) return json({ error: MESSAGES.rateLimited }, 429);
  try {
    return json(await resendNotificationEmail(prisma, { storeId: access.storeId }));
  } catch {
    return json({ error: MESSAGES.unavailable }, 500);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const access = await sellerStore(storeId);
  if (!access) return json({ error: "Not found" }, 404);
  return json(await removeNotificationEmail(prisma, { storeId: access.storeId }));
}
