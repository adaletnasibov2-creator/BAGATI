import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { Crumb } from "@/lib/category-tree";

export function CategoryBreadcrumbs({ crumbs, className = "" }: { crumbs: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted ${className}`}>
      {crumbs.map((crumb, index) => (
        <span key={`${crumb.name}-${index}`} className="flex min-w-0 items-center gap-2">
          {index > 0 && <ChevronRight aria-hidden="true" size={14} className="shrink-0" />}
          {crumb.href ? (
            <Link href={crumb.href} className="hover:text-emerald">{crumb.name}</Link>
          ) : (
            <span aria-current="page" className="min-w-0 truncate text-ink">{crumb.name}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
