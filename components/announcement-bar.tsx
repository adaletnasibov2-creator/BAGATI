import AnnouncementBarClient from "@/components/announcement-bar-client";
import { announcementPrePaintScript, announcementSignature, isAnnouncementVisible, type AnnouncementView } from "@/lib/announcement";
import { getSetting } from "@/lib/settings/read";
import { SETTING_KEYS } from "@/lib/settings/registry";

/**
 * Announcement bar above the header on every customer page (app/(customer)/layout.tsx). Server component:
 * reads announcement.bar through the 30 s cached, fail-safe read path; renders nothing when off or out of dates.
 * The inline script right after the bar hides it before first paint if this session already dismissed this text,
 * so dismissed visitors see no flash and no layout shift.
 */
export default async function AnnouncementBar() {
  const bar = await getSetting<AnnouncementView>(SETTING_KEYS.announcementBar);
  if (!bar || !isAnnouncementVisible(bar)) return null;
  const signature = announcementSignature(bar);
  return <>
    <section role="region" aria-label="Elan" data-announcement-bar={signature}>
      <AnnouncementBarClient bar={bar} signature={signature} />
    </section>
    <script dangerouslySetInnerHTML={{ __html: announcementPrePaintScript(signature) }} />
  </>;
}
