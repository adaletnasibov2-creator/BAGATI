import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, createRemoteJWKSet, jwtVerify } from "jose";
import { getPublicAppUrl } from "@/lib/password-reset";

export const GOOGLE_OAUTH_COOKIE = "bagati_google_oauth";
export const GOOGLE_OAUTH_COOKIE_MAX_AGE = 10 * 60;
const GOOGLE_ENDPOINTS = {
  authorization: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  jwks: "https://www.googleapis.com/oauth2/v3/certs",
} as const;
const LOCAL_TEST_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);
const LOCAL_OAUTH_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Google endpoints used for the code exchange and ID-token key set.
 *
 * Automated tests may point these at a loopback stand-in by setting BOTH
 * `BAGATI_ALLOW_OAUTH_TEST_ENDPOINTS=1` and `BAGATI_GOOGLE_OAUTH_TEST_ISSUER=http://127.0.0.1:<port>`.
 * The override is ignored unless the host is loopback HTTP, so a stray value cannot redirect a real
 * deployment's token exchange. Issuer, audience, nonce, and algorithm checks stay in force.
 */
export function googleEndpoints(env: Record<string, string | undefined> = process.env) {
  const override = env.BAGATI_GOOGLE_OAUTH_TEST_ISSUER?.trim();
  if (override && env.BAGATI_ALLOW_OAUTH_TEST_ENDPOINTS === "1" && env.NODE_ENV !== "production") {
    try {
      const base = new URL(override);
      if (LOCAL_TEST_HOSTNAMES.has(base.hostname) && base.protocol === "http:") {
        return { authorization: `${base.origin}/authorize`, token: `${base.origin}/token`, jwks: `${base.origin}/certs` };
      }
    } catch { /* Invalid override values fall through to the real Google endpoints. */ }
  }
  return GOOGLE_ENDPOINTS;
}

let cachedJwks: { url: string; keySet: ReturnType<typeof createRemoteJWKSet> } | undefined;
function googleJwks() {
  const url = googleEndpoints().jwks;
  if (!cachedJwks || cachedJwks.url !== url) cachedJwks = { url, keySet: createRemoteJWKSet(new URL(url)) };
  return cachedJwks.keySet;
}

export type GoogleOAuthIntent = "customer" | "vendor";
export type GoogleOAuthMode = "login" | "register" | "link";

export type GoogleOAuthState = {
  state: string;
  nonce: string;
  verifier: string;
  intent: GoogleOAuthIntent;
  mode: GoogleOAuthMode;
  next: string;
  accountUserId?: string;
};

export type GoogleIdentity = {
  sub: string;
  email: string;
  givenName: string;
  familyName: string;
  name: string;
};

function sessionSecret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET is not configured.");
  return value;
}

function oauthStateSecret() {
  return createHmac("sha256", sessionSecret()).update("BAGATI_GOOGLE_OAUTH_STATE_V1").digest();
}

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [first, second] = parts.map(Number);
  if (first === 10 || first === 127) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 169 && second === 254) return true;
  return false;
}

/** A development browser on a local host must not inherit the public APP_BASE_URL. The Host header wins over a rewritten request URL. */
function localDevelopmentOrigin(requestUrl: string | undefined, hostHeader?: string | null) {
  if (process.env.NODE_ENV === "production" || !requestUrl) return null;
  try {
    const request = new URL(requestUrl);
    const host = hostHeader?.trim().toLowerCase();
    const origin = host && !/[\s/\\@]/.test(host) ? `${request.protocol}//${host}` : request.origin;
    const hostname = new URL(origin).hostname;
    const local = LOCAL_OAUTH_HOSTS.has(hostname) || isPrivateIpv4(hostname) || !hostname.includes(".");
    if (!local || (request.protocol !== "http:" && request.protocol !== "https:")) return null;
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

/** Where an OAuth error page should land. Local hosts stay local. Production stays on the public site. */
export function oauthResponseOrigin(requestUrl: string, hostHeader?: string | null) {
  const local = localDevelopmentOrigin(requestUrl, hostHeader);
  if (local) return local;
  if (process.env.NODE_ENV === "production") return "https://shopbagati.com";
  try { return new URL(requestUrl).origin; } catch { return "http://127.0.0.1:3000"; }
}

export function googleOAuthConfig(requestUrl?: string, hostHeader?: string | null) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("Google OAuth credentials are not configured.");
  const origin = localDevelopmentOrigin(requestUrl, hostHeader) ?? getPublicAppUrl();
  const url = new URL(origin);
  if (process.env.NODE_ENV === "production" && url.hostname !== "shopbagati.com") {
    throw new Error("Production APP_BASE_URL must use the canonical shopbagati.com origin.");
  }
  return {
    clientId,
    clientSecret,
    origin,
    redirectUri: `${origin}/api/auth/google/callback`,
  };
}

/** The seller application is a customer-only page, so customers may return to it after login. */
const CUSTOMER_ALLOWED_VENDOR_PATHS = new Set(["/vendor/apply"]);

export function safeOAuthNextPath(value: string | null | undefined, intent: GoogleOAuthIntent) {
  const fallback = intent === "vendor" ? "/vendor" : "/account";
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const parsed = new URL(value, "https://bagati.invalid");
    if (parsed.origin !== "https://bagati.invalid") return fallback;
    if (intent === "vendor" && parsed.pathname !== "/vendor" && !parsed.pathname.startsWith("/vendor/")) return fallback;
    const vendorArea = parsed.pathname === "/vendor" || parsed.pathname.startsWith("/vendor/");
    const adminArea = parsed.pathname === "/admin" || parsed.pathname.startsWith("/admin/");
    if (intent === "customer" && ((vendorArea && !CUSTOMER_ALLOWED_VENDOR_PATHS.has(parsed.pathname)) || adminArea)) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function googleOAuthCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api/auth/google",
    maxAge: GOOGLE_OAUTH_COOKIE_MAX_AGE,
  };
}

export function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export async function createGoogleOAuthState(input: GoogleOAuthState) {
  return new SignJWT(input)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("bagati")
    .setAudience("bagati-google-oauth")
    .setIssuedAt()
    .setExpirationTime(`${GOOGLE_OAUTH_COOKIE_MAX_AGE}s`)
    .sign(oauthStateSecret());
}

export async function verifyGoogleOAuthState(token: string): Promise<GoogleOAuthState | null> {
  try {
    const { payload } = await jwtVerify(token, oauthStateSecret(), { algorithms: ["HS256"], issuer: "bagati", audience: "bagati-google-oauth" });
    if (
      typeof payload.state !== "string"
      || typeof payload.nonce !== "string"
      || typeof payload.verifier !== "string"
      || (payload.intent !== "customer" && payload.intent !== "vendor")
      || (payload.mode !== "login" && payload.mode !== "register" && payload.mode !== "link")
      || typeof payload.next !== "string"
      || (payload.mode === "link" && (typeof payload.accountUserId !== "string" || !payload.accountUserId))
      || (payload.mode !== "link" && payload.accountUserId !== undefined)
    ) return null;
    return {
      state: payload.state,
      nonce: payload.nonce,
      verifier: payload.verifier,
      intent: payload.intent,
      mode: payload.mode,
      next: payload.next,
      ...(typeof payload.accountUserId === "string" ? { accountUserId: payload.accountUserId } : {}),
    };
  } catch {
    return null;
  }
}

export async function googleAuthorizationUrl(input: {
  config: ReturnType<typeof googleOAuthConfig>;
  intent: GoogleOAuthIntent;
  mode: GoogleOAuthMode;
  next: string;
  accountUserId?: string;
}) {
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const signedState = await createGoogleOAuthState({
    state,
    nonce,
    verifier,
    intent: input.intent,
    mode: input.mode,
    next: input.next,
    ...(input.mode === "link" && input.accountUserId ? { accountUserId: input.accountUserId } : {}),
  });
  const authorization = new URL(googleEndpoints().authorization);
  authorization.search = new URLSearchParams({
    client_id: input.config.clientId,
    redirect_uri: input.config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "online",
    prompt: "select_account",
  }).toString();
  return { url: authorization, signedState };
}

export async function exchangeGoogleCode(code: string, verifier: string, config: ReturnType<typeof googleOAuthConfig>) {
  const response = await fetch(googleEndpoints().token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Google authorization-code exchange failed.");
  const tokenResponse: unknown = await response.json();
  if (!tokenResponse || typeof tokenResponse !== "object" || !("id_token" in tokenResponse) || typeof tokenResponse.id_token !== "string") {
    throw new Error("Google did not return an identity token.");
  }
  // Google's OpenID discovery document publishes id_token_signing_alg_values_supported = ["RS256"].
  const { payload } = await jwtVerify(tokenResponse.id_token, googleJwks(), {
    algorithms: ["RS256"],
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: config.clientId,
  });
  if (
    typeof payload.sub !== "string"
    || !payload.sub
    || typeof payload.email !== "string"
    || payload.email.length > 254
    || payload.email_verified !== true
    || typeof payload.nonce !== "string"
    || typeof payload.name !== "string" && payload.name !== undefined
    || typeof payload.given_name !== "string" && payload.given_name !== undefined
    || typeof payload.family_name !== "string" && payload.family_name !== undefined
    || (payload.azp !== undefined && payload.azp !== config.clientId)
  ) throw new Error("Google identity claims are invalid or the email is not verified.");
  const cleanName = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 80) : "";
  const email = payload.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Google returned an invalid email address.");
  return {
    identity: {
      sub: payload.sub,
      email,
      givenName: cleanName(payload.given_name),
      familyName: cleanName(payload.family_name),
      name: cleanName(payload.name),
    } satisfies GoogleIdentity,
    nonce: payload.nonce as string,
  };
}
