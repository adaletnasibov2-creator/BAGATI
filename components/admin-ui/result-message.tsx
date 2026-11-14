import type { ReactNode } from "react";

/**
 * Inline result of an action (the admin "toast"): success/info are announced politely (role=status), errors
 * immediately (role=alert). Placed next to the control that triggered it.
 */
export function ResultMessage({ tone, children, className = "" }: { tone: "success" | "error" | "info"; children: ReactNode; className?: string }) {
  const color = tone === "success" ? "bg-emerald-50 text-emerald-800" : tone === "error" ? "bg-red-50 text-red-700" : "bg-sky-50 text-sky-900";
  return <p role={tone === "error" ? "alert" : "status"} className={`rounded-lg p-3 text-sm whitespace-pre-line ${color}${className ? ` ${className}` : ""}`}>{children}</p>;
}
