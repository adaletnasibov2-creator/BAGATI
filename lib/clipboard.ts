/**
 * Copy text to the clipboard (SELLER-CUSTOMER-CARD-1). The modern async clipboard first; if that is missing or refused
 * (older browsers, non-secure context), a hidden read-only textarea and the legacy copy command. Never throws: the
 * caller shows "copied" or the manual-copy box. `env` is injectable so the fallback order can be unit-tested.
 */
export type ClipboardEnv = {
  writeText?: (text: string) => Promise<void>;
  legacyCopy?: (text: string) => boolean;
};

export async function copyToClipboard(text: string, env: ClipboardEnv = browserClipboardEnv()): Promise<boolean> {
  if (!text) return false;
  if (env.writeText) {
    try { await env.writeText(text); return true; } catch { /* fall through to the legacy copy */ }
  }
  try { return env.legacyCopy ? env.legacyCopy(text) : false; } catch { return false; }
}

function browserClipboardEnv(): ClipboardEnv {
  if (typeof window === "undefined") return {};
  return {
    writeText: navigator.clipboard?.writeText ? (text) => navigator.clipboard.writeText(text) : undefined,
    legacyCopy: (text) => {
      const area = document.createElement("textarea");
      area.value = text; area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0";
      document.body.appendChild(area); area.select();
      try { return document.execCommand("copy"); } finally { area.remove(); }
    },
  };
}
