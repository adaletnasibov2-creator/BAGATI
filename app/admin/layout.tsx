import type { Metadata } from "next";

/**
 * Every /admin page (including /admin/login) is kept out of search engines: robots metadata here, plus the
 * X-Robots-Tag header set in middleware.ts. Deliberately NOT listed in robots.txt, which would advertise the path.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false, noimageindex: true } },
};

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
