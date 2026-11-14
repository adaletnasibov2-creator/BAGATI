import { ContentPageView } from "@/components/content-page-view";

// Text from /admin/pages (ContentPage "privacy"); the built-in text when the page was never saved.
export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  return <ContentPageView slug="privacy" />;
}
