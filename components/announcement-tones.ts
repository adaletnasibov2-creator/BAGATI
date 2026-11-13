import type { AnnouncementView } from "@/lib/announcement";

/**
 * Tone styles of the announcement bar, shared by the live bar and the admin preview.
 * Kept under components/ on purpose: tailwind.config.ts only scans app/ and components/, so class names written in
 * lib/ are never generated (a white-on-white bar). scripts/announcement-bar.test.ts guards this.
 */
export const ANNOUNCEMENT_TONE_CLASSES: Record<AnnouncementView["tone"], string> = {
  info: "bg-[#173c40] text-white",
  success: "bg-green-700 text-white",
  warning: "bg-amber-300 text-[#2b2104]",
  danger: "bg-red-700 text-white",
};
