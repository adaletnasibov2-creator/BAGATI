import { BrandLogo } from "@/components/brand-logo";
import { ContentPageView } from "@/components/content-page-view";

// Text from /admin/pages (ContentPage "about"); the built-in text when the page was never saved.
export const dynamic = "force-dynamic";

export default function AboutPage() {
  return <ContentPageView slug="about" eyebrow="Platforma haqqında" before={<div className="mb-8"><BrandLogo variant="full" /></div>} />;
}
