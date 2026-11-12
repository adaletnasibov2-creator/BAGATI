import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { authRateLimitKey, consumeAuthProcessRateLimit, consumeAuthRateLimit, OAUTH_IP_RATE_LIMIT } from "@/lib/auth-rate-limit";
import { logAuthFailure } from "@/lib/auth-logging";
import { trustedCloudflareClientIp } from "@/lib/trusted-proxy";
import {
  GOOGLE_OAUTH_COOKIE,
  googleAuthorizationUrl,
  googleOAuthConfig,
  oauthResponseOrigin,
  googleOAuthCookieOptions,
  reportGoogleOAuthConfigIssues,
  safeOAuthNextPath,
  type GoogleOAuthIntent,
  type GoogleOAuthMode,
} from "@/lib/google-oauth";

function formPath(intent: GoogleOAuthIntent, mode: GoogleOAuthMode) {
  if (mode === "link") return intent === "vendor" ? "/vendor/security" : "/account/security";
  if (intent === "vendor") return "/vendor/login";
  return mode === "register" ? "/register" : "/login";
}

export async function GET(request: NextRequest) {
  const origin = oauthResponseOrigin(request.url, request.headers.get("host"));
  const params = request.nextUrl.searchParams;
  const intentValue = params.get("intent");
  const modeValue = params.get("mode");
  if ((intentValue !== "customer" && intentValue !== "vendor") || (modeValue !== "login" && modeValue !== "register" && modeValue !== "link")) {
    return NextResponse.redirect(new URL("/login?oauth=invalid", origin));
  }
  const intent: GoogleOAuthIntent = intentValue;
  const mode: GoogleOAuthMode = modeValue;
  // Seller accounts are never created through Google; sellers apply from a customer account at /vendor/apply.
  if (intent === "vendor" && mode === "register") {
    return NextResponse.redirect(new URL("/vendor/login?oauth=invalid", origin));
  }
  if (!consumeAuthProcessRateLimit("google-oauth-start", 600, 60_000)) {
    return NextResponse.redirect(new URL(`${formPath(intent, mode)}?oauth=unavailable`, origin));
  }
  const clientIp = trustedCloudflareClientIp(request.headers);
  if (clientIp) {
    try {
      const allowed = await consumeAuthRateLimit(
        authRateLimitKey("google-oauth-start", `ip:${clientIp}`),
        OAUTH_IP_RATE_LIMIT.limit,
        OAUTH_IP_RATE_LIMIT.windowMs,
      );
      if (!allowed) return NextResponse.redirect(new URL(`${formPath(intent, mode)}?oauth=unavailable`, origin));
    } catch (error) {
      logAuthFailure("google_oauth_start_rate_limit", error);
      return NextResponse.redirect(new URL(`${formPath(intent, mode)}?oauth=unavailable`, origin));
    }
  }
  const account = mode === "link" ? await currentUser() : null;
  if (mode === "link" && (!account || account.role !== intent.toUpperCase())) {
    return NextResponse.redirect(new URL(`${formPath(intent, mode)}?oauth=link-auth-required`, origin));
  }
  try {
    const config = googleOAuthConfig(request.url, request.headers.get("host"));
    const canonicalStart = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, config.origin);
    if (request.nextUrl.hostname === "www.shopbagati.com" && canonicalStart.hostname !== request.nextUrl.hostname) {
      return NextResponse.redirect(canonicalStart, 307);
    }
    const next = safeOAuthNextPath(params.get("next"), intent);
    const authorization = await googleAuthorizationUrl({
      config,
      intent,
      mode,
      next,
      ...(mode === "link" && account ? { accountUserId: account.id } : {}),
    });
    const response = NextResponse.redirect(authorization.url);
    response.cookies.set(GOOGLE_OAUTH_COOKIE, authorization.signedState, googleOAuthCookieOptions());
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    // Name the missing/invalid settings (never their values) so the server log explains "unavailable".
    if (!reportGoogleOAuthConfigIssues("google_oauth_start").length) logAuthFailure("google_oauth_start", error);
    return NextResponse.redirect(new URL(`${formPath(intent, mode)}?oauth=unavailable`, origin));
  }
}
