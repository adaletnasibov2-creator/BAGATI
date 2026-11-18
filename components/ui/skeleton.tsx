import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * Shimmer placeholder (the `.bagati-skeleton` animation in globals.css; it stops under prefers-reduced-motion).
 * Hidden from screen readers; wrap a group of them in `SkeletonRegion` so the loading state is announced once.
 */
const RADIUS = { none: "", control: "rounded-control", card: "rounded-card", full: "rounded-full" } as const;

export function Skeleton({ className, rounded = "control" }: { className?: string; rounded?: keyof typeof RADIUS }) {
  return <div aria-hidden="true" className={cx("bagati-skeleton", RADIUS[rounded], className)} />;
}

/** Text lines; the last one is shorter. */
export function SkeletonText({ lines = 2, className }: { lines?: number; className?: string }) {
  return <div aria-hidden="true" className={cx("grid gap-2", className)}>
    {Array.from({ length: lines }, (_, index) => <Skeleton key={index} rounded="full" className={cx("h-3.5", index === lines - 1 && lines > 1 ? "w-3/5" : "w-full")} />)}
  </div>;
}

/** A loading area: role="status" with one spoken label ("Yüklənir…"); the shapes inside stay silent. */
export function SkeletonRegion({ label = "Yüklənir…", className, children }: { label?: string; className?: string; children: ReactNode }) {
  return <div role="status" aria-live="polite" aria-busy="true" className={className}>
    <span className="sr-only">{label}</span>
    {children}
  </div>;
}
