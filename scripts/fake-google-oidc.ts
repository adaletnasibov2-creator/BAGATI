/**
 * Loopback stand-in for Google's OAuth token endpoint and JWKS. Test-only.
 * It checks the authorization code, PKCE S256 challenge, client credentials, and redirect URI,
 * then returns an RS256 ID token signed by a key it publishes at /certs.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

export type FakeGoogleIdentity = { sub: string; email: string; givenName?: string; familyName?: string; name?: string };
export type FakeGoogleTamper = "wrong-signature" | "unverified-email" | "wrong-audience" | "wrong-issuer" | "hs256";
export type IssuedCode = { nonce: string; codeChallenge: string; identity: FakeGoogleIdentity; tamper?: FakeGoogleTamper };

export type FakeGoogle = {
  issuer: string;
  tokenRequests: Array<Record<string, string>>;
  issueCode(input: IssuedCode): string;
  close(): Promise<void>;
};

export async function startFakeGoogle(client: { clientId: string; clientSecret: string; redirectUri: string }): Promise<FakeGoogle> {
  const signing = await generateKeyPair("RS256", { extractable: true });
  const rogue = await generateKeyPair("RS256", { extractable: true });
  const publicJwk = { ...(await exportJWK(signing.publicKey)), kid: "fake-google-signing-key", alg: "RS256", use: "sig" };
  const codes = new Map<string, IssuedCode>();
  const tokenRequests: Array<Record<string, string>> = [];

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(body));
    };
    if (request.method === "GET" && url.pathname === "/certs") return json(200, { keys: [publicJwk] });
    if (request.method !== "POST" || url.pathname !== "/token") return json(404, { error: "not_found" });
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { raw += chunk; });
    request.on("end", () => {
      void (async () => {
        const params = Object.fromEntries(new URLSearchParams(raw));
        tokenRequests.push(params);
        const issued = codes.get(params.code ?? "");
        const challenge = createHash("sha256").update(params.code_verifier ?? "").digest("base64url");
        if (!issued || params.grant_type !== "authorization_code" || params.client_id !== client.clientId || params.client_secret !== client.clientSecret || params.redirect_uri !== client.redirectUri || challenge !== issued.codeChallenge) {
          return json(400, { error: "invalid_grant" });
        }
        codes.delete(params.code);
        const claims: Record<string, unknown> = {
          email: issued.identity.email,
          email_verified: issued.tamper !== "unverified-email",
          nonce: issued.nonce,
          azp: client.clientId,
          ...(issued.identity.givenName ? { given_name: issued.identity.givenName } : {}),
          ...(issued.identity.familyName ? { family_name: issued.identity.familyName } : {}),
          ...(issued.identity.name ? { name: issued.identity.name } : {}),
        };
        const builder = new SignJWT(claims)
          .setIssuer(issued.tamper === "wrong-issuer" ? "https://accounts.example.invalid" : "https://accounts.google.com")
          .setAudience(issued.tamper === "wrong-audience" ? "another-client.apps.googleusercontent.com" : client.clientId)
          .setSubject(issued.identity.sub)
          .setIssuedAt()
          .setExpirationTime("5m");
        const idToken = issued.tamper === "hs256"
          ? await builder.setProtectedHeader({ alg: "HS256", kid: "fake-google-signing-key" }).sign(new TextEncoder().encode(JSON.stringify(publicJwk)))
          : await builder.setProtectedHeader({ alg: "RS256", kid: "fake-google-signing-key" }).sign(issued.tamper === "wrong-signature" ? rogue.privateKey : signing.privateKey);
        json(200, { access_token: "fake-access-token", token_type: "Bearer", expires_in: 3600, scope: "openid email profile", id_token: idToken });
      })().catch(() => json(500, { error: "server_error" }));
    });
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fake Google server did not expose a port.");
  return {
    issuer: `http://127.0.0.1:${address.port}`,
    tokenRequests,
    issueCode(input) {
      const code = randomBytes(24).toString("base64url");
      codes.set(code, input);
      return code;
    },
    close: () => new Promise<void>((resolvePromise) => server.close(() => resolvePromise())),
  };
}
