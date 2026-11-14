import { ContentPageView } from "@/components/content-page-view";

// Text from /admin/pages (ContentPage "help"); the built-in text when the page was never saved.
export const dynamic = "force-dynamic";

export default function HelpPage() {
  return <ContentPageView slug="help" eyebrow="Məlumat" />;
}
