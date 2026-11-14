import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import { requireRole } from "@/lib/auth";
import { normalizeAdminPage, normalizeAdminSearch, normalizeAdminSearchParams } from "@/lib/admin-pagination";
import type { SectionContext } from "../_sections/shared";
import { ADMIN_SECTIONS } from "../_sections";

export const dynamic = "force-dynamic";

/**
 * Admin section router. Every section lives in app/admin/_sections/<name>.tsx and is listed in ADMIN_SECTIONS
 * (app/admin/_sections/index.ts) with its route condition, in the original order: the first match renders.
 * ADMIN is required before any section runs; an unknown section is a 404.
 */
export default async function AdminSectionPage({ params, searchParams }: { params: Promise<{ section: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) redirect("/admin/login");
  const [{ section: parts }, rawSearchParams] = await Promise.all([params, searchParams]);
  const sp = normalizeAdminSearchParams(rawSearchParams);
  const route = parts.join("/");
  const q = normalizeAdminSearch(sp.q);
  const page = normalizeAdminPage(sp.page);
  const take = 25, skip = (page - 1) * take;
  const pageQuery = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== "page" && Boolean(v)) as [string, string][]).toString();
  const shell = (content: ReactNode) => <AdminShell email={admin.email}>{content}</AdminShell>;
  const ctx: SectionContext = { admin, parts, route, sp, q, page, take, skip, pageQuery, shell };
  for (const section of ADMIN_SECTIONS) if (section.match({ route, parts })) return section.render(ctx);
  notFound();
}
