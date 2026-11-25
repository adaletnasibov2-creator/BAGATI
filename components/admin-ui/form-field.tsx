import type { ReactNode } from "react";

/**
 * Label + control + optional hint/error. The control is passed as children; give it `id={htmlFor}` and, when a hint or
 * error is shown, `aria-describedby={`${htmlFor}-hint`}` / `${htmlFor}-error`.
 */
export function FormField({ label, htmlFor, hint, error, required, children }: { label: ReactNode; htmlFor: string; hint?: ReactNode; error?: ReactNode; required?: boolean; children: ReactNode }) {
  return <div className="grid gap-1.5 text-sm text-fg-body">
    <label htmlFor={htmlFor} className="font-medium text-fg">{label}{required && <span aria-hidden="true" className="ml-0.5 text-red-700">*</span>}</label>
    {children}
    {hint && !error && <p id={`${htmlFor}-hint`} className="text-xs text-fg-secondary">{hint}</p>}
    {error && <p id={`${htmlFor}-error`} role="alert" className="text-xs text-red-700">{error}</p>}
  </div>;
}
