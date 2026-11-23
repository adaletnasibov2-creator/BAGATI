import { NextRequest, NextResponse } from "next/server";
import { bodyTooLargeResponse, JSON_BODY_LIMITS, readJsonCapped } from "@/lib/json-body";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeDeliveryCoordinates, OUTSIDE_AZERBAIJAN_MESSAGE } from "@/lib/delivery-location";
import { rememberProfilePhoneIfEmpty } from "@/lib/profile-phone";
import { AZ_PHONE_ERROR, normalizeAzMobilePhone } from "@/lib/az-phone";

const schema = z.object({ cityId: z.string().min(1), recipientName: z.string().trim().min(2).max(120), phone: z.string().trim().min(7).max(30), line1: z.string().trim().min(4).max(240), line2: z.string().trim().max(240).optional(), label: z.string().trim().max(60).optional(), postalCode: z.string().trim().max(20).optional(), latitude: z.number().finite().min(-90).max(90).nullable().optional(), longitude: z.number().finite().min(-180).max(180).nullable().optional(), isDefault: z.boolean().optional(), rememberPhone: z.boolean().optional() });
export async function GET() {
  const user = await requireRole("CUSTOMER");
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const items = await prisma.address.findMany({ where: { userId: user.id }, include: { city: { select: { id: true, name: true } } }, orderBy: [{ isDefault: "desc" }, { id: "desc" }] });
  return NextResponse.json({ items });
}
export async function POST(request: NextRequest) {
  const user = await requireRole("CUSTOMER");
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  let body: unknown;
  try { body = await readJsonCapped(request, JSON_BODY_LIMITS.small); } catch (error) { return bodyTooLargeResponse(error) ?? NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  // PHONE-REQUIRED-1: a missing or invalid phone gets the Azerbaijani phone message (not the generic one).
  if (!parsed.success && parsed.error.issues.some((issue) => issue.path[0] === "phone")) return NextResponse.json({ error: AZ_PHONE_ERROR, code: "PHONE_INVALID" }, { status: 400 });
  if (!parsed.success) return NextResponse.json({ error: "Review the address details", details: parsed.error.flatten() }, { status: 400 });
  // Only an Azerbaijani mobile number, stored as +994XXXXXXXXX (lib/az-phone.ts).
  const mobilePhone = normalizeAzMobilePhone(parsed.data.phone);
  if (!mobilePhone) return NextResponse.json({ error: AZ_PHONE_ERROR, code: "PHONE_INVALID" }, { status: 400 });
  parsed.data.phone = mobilePhone;
  if ((parsed.data.latitude == null) !== (parsed.data.longitude == null)) return NextResponse.json({ error: "Xəritə koordinatları birlikdə daxil edilməlidir" }, { status: 422 });
  if (parsed.data.latitude != null) {
    const pin = normalizeDeliveryCoordinates(parsed.data.latitude, parsed.data.longitude);
    if (!pin) return NextResponse.json({ error: OUTSIDE_AZERBAIJAN_MESSAGE }, { status: 422 });
    Object.assign(parsed.data, pin);
  }
  const city = await prisma.city.findFirst({ where: { id: parsed.data.cityId, isActive: true }, select: { id: true } });
  if (!city) return NextResponse.json({ error: "Active city not found" }, { status: 400 });
  // rememberPhone is a request flag (checkout), not an Address column: keep it out of the create.
  const { rememberPhone, ...address } = parsed.data;
  const hasAddress = await prisma.address.count({ where: { userId: user.id } });
  const item = await prisma.$transaction(async transaction => {
    const tx: any = transaction;
    const makeDefault = address.isDefault === true || hasAddress === 0;
    if (makeDefault) await tx.address.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
    return tx.address.create({ data: { ...address, userId: user.id, isDefault: makeDefault } });
  });
  // SIGNUP-EASY-1 R4: after the address is saved, fill an EMPTY profile phone (never overwrite). Best-effort: a failure
  // here never fails the address save.
  if (rememberPhone) {
    try { await rememberProfilePhoneIfEmpty(prisma, user.id, address.phone); }
    catch (error) { console.error(`profile phone not remembered (${error instanceof Error ? error.name : "unknown"})`); }
  }
  return NextResponse.json({ item }, { status: 201 });
}
