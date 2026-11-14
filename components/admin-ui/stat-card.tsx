import Link from "next/link";
import type { ReactNode } from "react";
import { focusRing } from "@/components/admin-ui/styles";

/** Counter tile; a link when `href` is given. Compact on phones (two per row in a grid-cols-2 parent). */
export function StatCard({ label, value, href, hint }: { label: ReactNode; value: ReactNode; href?: string; hint?: ReactNode }) {
  const body = <>
    <p className="text-xs text-slate-500 sm:text-sm">{label}</p>
    <p className="mt-2 text-2xl font-semibold text-[#0d1b2a] sm:mt-3 sm:text-3xl">{value}</p>
    {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
  </>;
  const className = "block rounded-2xl border border-[#e7e3d9] bg-white p-3.5 sm:p-5";
  return href
    ? <Link href={href} className={`${className} transition hover:border-[#c7ad78] ${focusRing}`}>{body}</Link>
    : <div className={className}>{body}</div>;
}
