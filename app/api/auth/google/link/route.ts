import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { createSession } from "@/lib/auth";
import { logAuthFailure } from "@/lib/auth-logging";
import { LOGIN_RATE_LIMIT, authRateLimitKey, consumeAuthRateLimit } from "@/lib/auth-rate-limit";
import {
  GOOGLE_LINK_COOKIE,
  GOOGLE_LINK_NEXT_COOKIE,
  consumeGoogleLink,
  expiredGoogleLinkCookie,
  expiredGoogleLinkNextCookie,
  googleLinkDestination,
  hashGoogleLinkToken,
  isGoogleLinkableRole,
  isMissingGoogleLinkStore,
  readCurrentGoogleLinkChallenge,
} from "@/lib/google-link";
import { prisma } from "@/lib/prisma";

const schema = z.object({ password: z.string().min(1).max(128) });

export async function GET() {
  try {
    const challenge = await readCurrentGoogleLinkChallenge();
    return NextResponse.json(challenge, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logAuthFailure("google_link_challenge", error);
    return NextResponse.json({ status: "invalid" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

function clearLinkCookies(response: NextResponse) {
  response.cookies.set(expiredGoogleLinkCookie());
  response.cookies.set(expiredGoogleLinkNextCookie());
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Sorğu məlumatları yanlışdır." }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Şifrə yanlışdır." }, { status: 400, headers: { "Cache-Control": "no-store" } });

  const token = request.cookies.get(GOOGLE_LINK_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: "Google təsdiqinin vaxtı bitib. Google ilə yenidən davam edin." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const rateKey = authRateLimitKey("login", `google-link:${hashGoogleLinkToken(token)}`);
    if (!await consumeAuthRateLimit(rateKey, LOGIN_RATE_LIMIT.limit, LOGIN_RATE_LIMIT.windowMs)) {
      return NextResponse.json({ error: "Çox sayda cəhd edildi. Bir müddət sonra yenidən yoxlayın." }, { status: 429, headers: { "Cache-Control": "no-store" } });
    }
  } catch (error) {
    logAuthFailure("google_link_rate_limit", error);
    return NextResponse.json({ error: "Təsdiq xidməti hazırda əlçatan deyil." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const row = await prisma.googleLinkTransaction.findUnique({ where: { tokenHash: hashGoogleLinkToken(token) } });
    if (!row) {
      const response = NextResponse.json({ error: "Google təsdiqinin vaxtı bitib. Google ilə yenidən davam edin." }, { status: 400, headers: { "Cache-Control": "no-store" } });
      clearLinkCookies(response);
      return response;
    }
    if (row.usedAt) {
      const response = NextResponse.json({ error: "Bu Google təsdiqi artıq istifadə olunub. Google ilə yenidən davam edin." }, { status: 409, headers: { "Cache-Control": "no-store" } });
      clearLinkCookies(response);
      return response;
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      const response = NextResponse.json({ error: "Google təsdiqinin vaxtı bitib. Google ilə yenidən davam edin." }, { status: 410, headers: { "Cache-Control": "no-store" } });
      clearLinkCookies(response);
      return response;
    }

    const user = await prisma.user.findUnique({ where: { id: row.userId } });
    if (!user?.isActive || !user.passwordAuthEnabled || !isGoogleLinkableRole(user.role) || user.email.trim().toLowerCase() !== row.email) {
      const response = NextResponse.json({ error: "Bu hesabı Google ilə bağlamaq mümkün deyil." }, { status: 403, headers: { "Cache-Control": "no-store" } });
      clearLinkCookies(response);
      return response;
    }
    if (!(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      return NextResponse.json({ error: "Şifrə yanlışdır. Google təsdiqi saxlanıldı, yenidən cəhd edə bilərsiniz." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }

    const linked = await consumeGoogleLink(token, user);
    if (linked !== "linked") {
      const response = NextResponse.json({ error: "Google hesabını bağlamaq mümkün olmadı. Google ilə yenidən davam edin." }, { status: 409, headers: { "Cache-Control": "no-store" } });
      clearLinkCookies(response);
      return response;
    }

    const session = await createSession(user.id);
    const response = NextResponse.json(
      { redirect: googleLinkDestination(user.role, request.cookies.get(GOOGLE_LINK_NEXT_COOKIE)?.value) },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(session);
    clearLinkCookies(response);
    return response;
  } catch (error) {
    if (isMissingGoogleLinkStore(error)) {
      logAuthFailure("google_link_transaction_store", error);
      return NextResponse.json({ error: "Google bağlantısı bu serverdə hələ saxlanıla bilmir. E-poçt və şifrə ilə daxil olun." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    logAuthFailure("google_link_confirm", error);
    return NextResponse.json({ error: "Google hesabını bağlamaq mümkün olmadı. Yenidən cəhd edin." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
