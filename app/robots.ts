import type { MetadataRoute } from "next";
import { robotsConfig } from "@/lib/structured-data";

// SEO-1: read APP_BASE_URL at request time (not frozen at build). No database.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return robotsConfig();
}
