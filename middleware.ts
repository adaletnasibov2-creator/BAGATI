import { NextRequest, NextResponse } from "next/server";
import { csrfRejection, isCsrfExemptApiPath } from "@/lib/csrf";
import { canonicalHostRedirectUrl } from "@/lib/host-policy";

export function middleware(request: NextRequest) {
  const canonical = canonicalHostRedirectUrl(request.url, request.headers.get("host"));
  if (canonical) return NextResponse.redirect(canonical, 308);
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/") && !isCsrfExemptApiPath(pathname)) {
    const rejected = csrfRejection(request);
    if (rejected) return rejected;
  }
  const response = NextResponse.next();
  if (personalizedDocument(pathname, request.cookies.has("bagati_session"))) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "Cookie");
  }
  return response;
}

function personalizedDocument(pathname: string, hasSession: boolean) {
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/")) return false;
  if (hasSession) return true;
  return ["/account", "/orders", "/vendor", "/admin", "/checkout", "/cart", "/login", "/register", "/favorites", "/auth"].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
