import { ContentPageView } from "@/components/content-page-view";

// Text from /admin/pages (ContentPage "terms"); the built-in text when the page was never saved.
export const dynamic = "force-dynamic";

export default function TermsPage() {
  return <ContentPageView slug="terms" />;
}
