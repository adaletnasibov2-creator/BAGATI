import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { logAuthFailure } from "@/lib/auth-logging";
import { unlinkGoogleAccount } from "@/lib/google-link";

export async function POST() {
  const account = await currentUser();
  if (!account) {
    return NextResponse.json({ error: "Əvvəlcə BAGATI hesabına daxil olun." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const result = await unlinkGoogleAccount(account.id);
    if (result === "password-required") {
      return NextResponse.json(
        { error: "Google bağlantısını silmək mümkün deyil, çünki hesabda başqa giriş üsulu yoxdur.", code: "unlink-blocked" },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (result !== "unlinked") {
      return NextResponse.json({ error: "Google bağlantısı silinmədi." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ ok: true, googleLink: "unlinked" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logAuthFailure("google_unlink", error);
    return NextResponse.json({ error: "Google bağlantısı silinmədi. Bir az sonra yenidən cəhd edin." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
