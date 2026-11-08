import { NextResponse } from "next/server";
import { destroySession, expiredSessionCookie } from "@/lib/auth";
import { csrfRejection } from "@/lib/csrf";
import { clearEmailVerificationContext } from "@/lib/email-verification";
export async function POST(request: Request) {
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  try {
    await destroySession();
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store", Vary: "Cookie" } });
    response.cookies.set(expiredSessionCookie());
    clearEmailVerificationContext(response);
    return response;
  } catch {
    const response = NextResponse.json({ error: "Sessiyanı serverdə bağlamaq mümkün olmadı. Yenidən cəhd edin." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    response.cookies.set(expiredSessionCookie());
    clearEmailVerificationContext(response);
    return response;
  }
}
