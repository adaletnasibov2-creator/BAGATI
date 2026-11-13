/**
 * Announcement bar rules (pure, unit-tested; no database, no environment, safe for client imports).
 * Visibility follows the style of isHomeBannerVisible: enabled, and inside the optional start/end dates.
 */
export type AnnouncementView = {
  enabled: boolean;
  text: string;
  href: string | null;
  tone: "info" | "success" | "warning" | "danger";
  startsAt: string | null;
  endsAt: string | null;
};

export const ANNOUNCEMENT_DISMISS_KEY = "bagati.announcement.dismissed";

export function isAnnouncementVisible(bar: AnnouncementView | null, now = new Date()): boolean {
  if (!bar || !bar.enabled || !bar.text.trim()) return false;
  if (bar.startsAt && new Date(bar.startsAt) > now) return false;
  if (bar.endsAt && new Date(bar.endsAt) < now) return false;
  return true;
}

/**
 * Short signature of what the visitor sees (text, link, tone). A dismissal is remembered for this signature only,
 * so a changed text shows the bar again. FNV-1a 32-bit, hex: deterministic and safe inside an attribute or script.
 */
export function announcementSignature(bar: Pick<AnnouncementView, "text" | "href" | "tone">): string {
  const input = `${bar.tone}\u0000${bar.text}\u0000${bar.href ?? ""}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Inline script run before first paint: hides the bar if this session dismissed this exact text. */
export function announcementPrePaintScript(signature: string): string {
  if (!/^[0-9a-f]{8}$/.test(signature)) throw new Error("invalid announcement signature");
  return `try{if(sessionStorage.getItem(${JSON.stringify(ANNOUNCEMENT_DISMISS_KEY)})===${JSON.stringify(signature)}){var s=document.createElement("style");s.textContent='[data-announcement-bar="${signature}"]{display:none}';document.head.appendChild(s)}}catch(e){}`;
}

export const ANNOUNCEMENT_TONE_CLASSES: Record<AnnouncementView["tone"], string> = {
  info: "bg-[#173c40] text-white",
  success: "bg-green-700 text-white",
  warning: "bg-amber-300 text-[#2b2104]",
  danger: "bg-red-700 text-white",
};
