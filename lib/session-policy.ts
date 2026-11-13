/** Session lifetime rules and the display-safe session metadata. Pure; no database or request access. */
import type { Role } from "@prisma/client";

export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12;
/** Admin sessions end after this long without a request. */
export const ADMIN_IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
/** lastSeenAt is written at most this often per session, so normal browsing does not write on every request. */
export const SESSION_LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60 * 1000;

export function sessionTtlSeconds(role: Role): number {
  return role === "ADMIN" ? ADMIN_SESSION_TTL_SECONDS : DEFAULT_SESSION_TTL_SECONDS;
}

/** Only admin sessions track activity and have an idle timeout. */
export function tracksSessionActivity(role: Role): boolean {
  return role === "ADMIN";
}

export function isSessionIdleExpired(input: { role: Role; lastSeenAt: Date | null; createdAt: Date; now: Date }): boolean {
  if (!tracksSessionActivity(input.role)) return false;
  const lastActivity = input.lastSeenAt ?? input.createdAt;
  return input.now.getTime() - lastActivity.getTime() > ADMIN_IDLE_TIMEOUT_MS;
}

export function shouldWriteLastSeen(lastSeenAt: Date | null, now: Date): boolean {
  return !lastSeenAt || now.getTime() - lastSeenAt.getTime() >= SESSION_LAST_SEEN_WRITE_INTERVAL_MS;
}

/** Short, non-identifying browser description, e.g. "Chrome 140 · Windows". Never stores the full header. */
export function summarizeUserAgent(header: string | null | undefined): string | null {
  const ua = (header ?? "").slice(0, 512);
  if (!ua.trim()) return null;
  const browser =
    /Edg\/(\d+)/.exec(ua) ? `Edge ${/Edg\/(\d+)/.exec(ua)![1]}` :
    /OPR\/(\d+)/.exec(ua) ? `Opera ${/OPR\/(\d+)/.exec(ua)![1]}` :
    /Firefox\/(\d+)/.exec(ua) ? `Firefox ${/Firefox\/(\d+)/.exec(ua)![1]}` :
    /(?:Chrome|CriOS)\/(\d+)/.exec(ua) ? `Chrome ${/(?:Chrome|CriOS)\/(\d+)/.exec(ua)![1]}` :
    /Version\/(\d+).*Safari\//.exec(ua) ? `Safari ${/Version\/(\d+).*Safari\//.exec(ua)![1]}` :
    "Naməlum brauzer";
  const os =
    /Windows NT/.test(ua) ? "Windows" :
    /Android/.test(ua) ? "Android" :
    /iPhone|iPad|iPod/.test(ua) ? "iOS" :
    /Mac OS X|Macintosh/.test(ua) ? "macOS" :
    /Linux/.test(ua) ? "Linux" :
    "naməlum sistem";
  return `${browser} · ${os}`;
}
