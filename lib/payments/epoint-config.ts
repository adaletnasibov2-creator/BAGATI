export type EpointEnvironment = "sandbox" | "production";

export type EpointConfig = {
  environment: EpointEnvironment;
  publicKey: string;
  privateKey: string;
  createPaymentUrl: string;
  statusUrl: string;
  appBaseUrl: string;
};

function httpsEndpoint(value: string | undefined, environment: EpointEnvironment) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.username || url.password || url.hash) return null;
    if (url.protocol === "https:") return url.toString();
    if (environment === "sandbox" && url.protocol === "http:" && local) return url.toString();
    return null;
  } catch {
    return null;
  }
}

/** Explicit opt-in. Missing or partial configuration never selects a fake gateway. */
export function readEpointConfig(env: NodeJS.ProcessEnv = process.env): EpointConfig | null {
  if (env.EPOINT_PAYMENTS_ENABLED !== "1") return null;
  const environment = env.EPOINT_ENVIRONMENT === "sandbox" || env.EPOINT_ENVIRONMENT === "production" ? env.EPOINT_ENVIRONMENT : null;
  if (!environment) return null;
  const publicKey = env.EPOINT_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.EPOINT_PRIVATE_KEY ?? "";
  const createPaymentUrl = httpsEndpoint(env.EPOINT_CREATE_PAYMENT_URL, environment);
  const statusUrl = httpsEndpoint(env.EPOINT_STATUS_URL, environment);
  const appBase = env.APP_BASE_URL?.trim() ?? "";
  let appBaseUrl: string | null = null;
  try {
    const url = new URL(appBase);
    if (environment === "production" && url.protocol === "https:") appBaseUrl = url.origin;
    if (environment === "sandbox" && (url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1")) appBaseUrl = url.origin;
  } catch { /* An unusable origin keeps payments disabled. */ }
  if (!environment || !publicKey || !privateKey.trim() || !createPaymentUrl || !statusUrl || !appBaseUrl) return null;
  return { environment, publicKey, privateKey, createPaymentUrl, statusUrl, appBaseUrl };
}
