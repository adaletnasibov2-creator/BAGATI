/** Header value that keeps admin pages and admin APIs out of search engines (set in middleware.ts). */
export const ADMIN_X_ROBOTS_TAG = "noindex, nofollow, noarchive";

/**
 * /admin, /admin/*, /api/admin and /api/admin/* (not /administrator or /admins). These get X-Robots-Tag; they are
 * deliberately NOT listed in robots.txt, which would advertise the admin path.
 */
export function isAdminSurface(pathname: string) {
  return ["/admin", "/api/admin"].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
