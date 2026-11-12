import { NextResponse } from "next/server";

/**
 * Seller self-registration is closed. A seller starts as a customer account and submits the
 * seller application at /vendor/apply; stores then go through admin review. Nothing is created here.
 */
const SELLER_SELF_REGISTRATION_CLOSED_MESSAGE =
  "Satıcı hesabı birbaşa yaradılmır. Əvvəlcə müştəri kimi qeydiyyatdan keçin, sonra satıcı müraciəti göndərin və admin təsdiqini gözləyin.";

export async function POST() {
  return NextResponse.json(
    {
      error: SELLER_SELF_REGISTRATION_CLOSED_MESSAGE,
      code: "SELLER_SELF_REGISTRATION_CLOSED",
      registerPath: "/register?next=%2Fvendor%2Fapply",
      applyPath: "/vendor/apply",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
