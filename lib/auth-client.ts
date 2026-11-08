const AUTH_CHANGED_KEY = "bagati:auth:changed";
const AUTH_CHANNEL = "bagati-auth";

/** One id per page load. Other tabs have their own module instance and therefore a different id. */
const tabId = globalThis.crypto?.randomUUID?.() ?? `tab-${Date.now()}-${Math.random()}`;

export function shouldReloadForAuthBroadcast(data: unknown, localSender = tabId) {
  if (!data || typeof data !== "object") return false;
  const message = data as { type?: unknown; sender?: unknown };
  return message.type === "changed" && message.sender !== localSender;
}

/** Broadcasts only a generic change marker; identity and credentials never leave the server. */
export function announceAuthChange() {
  try { localStorage.setItem(AUTH_CHANGED_KEY, String(Date.now())); } catch { /* Storage may be disabled. */ }
  try {
    const channel = new BroadcastChannel(AUTH_CHANNEL);
    channel.postMessage({ type: "changed", sender: tabId });
    channel.close();
  } catch { /* BroadcastChannel may be unavailable. */ }
}

/** Leaves this document for a fresh server render. Does not run when logout or login failed. */
export function finishAuthNavigation(path: string) {
  announceAuthChange();
  window.location.replace(path);
}

export async function postLogout(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch("/api/auth/logout", { method: "POST", cache: "no-store", credentials: "same-origin" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: typeof data.error === "string" ? data.error : "Hesabdan çıxış mümkün olmadı." };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof TypeError ? "Bağlantı xətası. Yenidən cəhd edin." : "Hesabdan çıxış mümkün olmadı." };
  }
}

export const authSyncKeys = { storage: AUTH_CHANGED_KEY, channel: AUTH_CHANNEL } as const;
