import { NextRequest, NextResponse } from "next/server";
import { bodyTooLargeResponse, JSON_BODY_LIMITS, readJsonCapped } from "@/lib/json-body";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AZ_PHONE_ERROR } from "@/lib/az-phone";
import { profilePhoneInput } from "@/lib/profile-phone";

const schema = z.object({ firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80), phone: z.string().trim().max(30).optional() });
export async function GET() {
  const user = await requireRole("CUSTOMER");
  if (!user) return NextResponse.json({ error: "Giriş tələb olunur" }, { status: 401 });
  const profile = await prisma.customerProfile.findUnique({ where: { userId: user.id } });
  return NextResponse.json({ profile, email: user.email });
}
export async function PATCH(request: NextRequest) {
  const user = await requireRole("CUSTOMER");
  if (!user) return NextResponse.json({ error: "Giriş tələb olunur" }, { status: 401 });
  let body: unknown;
  try { body = await readJsonCapped(request, JSON_BODY_LIMITS.small); } catch (error) { return bodyTooLargeResponse(error) ?? NextResponse.json({ error: "Yanlış JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  // CLEANUP-1 (L3): a phone problem gets the same Azerbaijani phone message as addresses and orders.
  if (!parsed.success && parsed.error.issues.some((issue) => issue.path[0] === "phone")) return NextResponse.json({ error: AZ_PHONE_ERROR, code: "PHONE_INVALID" }, { status: 400 });
  if (!parsed.success) return NextResponse.json({ error: "Profil məlumatlarını yoxlayın", details: parsed.error.flatten() }, { status: 400 });
  // Same validator as orders (normalizeAzMobilePhone); stored as +994XXXXXXXXX. Empty stays allowed; not sent = unchanged.
  const phone = profilePhoneInput(parsed.data.phone);
  if (phone === null) return NextResponse.json({ error: AZ_PHONE_ERROR, code: "PHONE_INVALID" }, { status: 400 });
  const data = { firstName: parsed.data.firstName, lastName: parsed.data.lastName, ...(phone !== undefined ? { phone } : {}) };
  const profile = await prisma.customerProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
  return NextResponse.json({ profile });
}

