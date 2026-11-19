import type { NextConfig } from "next";
import { STATIC_ASSET_CACHE_CONTROL } from "./lib/static-asset-paths";
const nextConfig: NextConfig = {
  // Allow isolated smoke-test builds without sharing .next with a running dev server.
  distDir: process.env.BAGATI_NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  async headers() {
    const headers = [
      { key: "X-BAGATI-Application", value: "bagati-marketplace" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
    ];
    if (process.env.NODE_ENV === "production") {
      headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000" });
    }
    return [
      { source: "/uploads/:path*", headers: [...headers, { key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      // Public static files without fingerprinted names (SCALE-FIX-1 A2): before, Next's default was max-age=0.
      { source: "/images/:path*", headers: [...headers, { key: "Cache-Control", value: STATIC_ASSET_CACHE_CONTROL }] },
      { source: "/bagati-mark.svg", headers: [...headers, { key: "Cache-Control", value: STATIC_ASSET_CACHE_CONTROL }] },
      { source: "/icon.svg", headers: [...headers, { key: "Cache-Control", value: STATIC_ASSET_CACHE_CONTROL }] },
      { source: "/:path*", headers },
    ];
  },
};
export default nextConfig;
