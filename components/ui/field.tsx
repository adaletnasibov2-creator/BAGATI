import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cx, focusRing } from "./cx";

type FieldBase = {
  /** Required: ties the label, hint and error to the control. */
  id: string;
  label: ReactNode;
  /** Help text under the control (`${id}-hint`). */
  hint?: ReactNode;
  /** Error text (`${id}-error`); also sets aria-invalid and the red border. */
  error?: ReactNode;
  /** Class for the wrapper; the control's own class goes in `controlClassName`. */
  className?: string;
  controlClassName?: string;
};

/**
 * Control style: 48 px tall, 12 px radius, white. The border is #7b968c (3.19:1 on white, WCAG 2.2 non-text
 * contrast); focus adds the 2 px primary ring.
 */
export function controlClass(invalid = false): string {
  return cx(
    "block w-full min-h-12 rounded-control border bg-white px-4 py-3 text-body text-fg placeholder:text-fg-muted",
    "transition-colors duration-150 motion-reduce:transition-none",
    "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:opacity-70",
    focusRing,
    "focus-visible:outline-offset-1",
    invalid ? "border-danger" : "border-line-strong hover:border-primary focus:border-primary",
  );
}

function describedBy(id: string, hint: ReactNode, error: ReactNode, extra?: string) {
  const ids = [extra, hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ");
  return ids || undefined;
}

function FieldShell({ id, label, hint, error, className, children }: Omit<FieldBase, "controlClassName"> & { children: ReactNode }) {
  return <div className={cx("grid gap-1.5", className)}>
    <label htmlFor={id} className="text-sm font-medium text-fg">{label}</label>
    {children}
    {hint && <p id={`${id}-hint`} className="text-xs text-fg-muted">{hint}</p>}
    {error && <p id={`${id}-error`} role="alert" className="text-sm font-medium text-danger">{error}</p>}
  </div>;
}

export type InputProps = FieldBase & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className">;

export function Input({ id, label, hint, error, className, controlClassName, "aria-describedby": extra, ...props }: InputProps) {
  return <FieldShell id={id} label={label} hint={hint} error={error} className={className}>
    <input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error, extra)} className={cx(controlClass(Boolean(error)), controlClassName)} {...props} />
  </FieldShell>;
}

export type TextareaProps = FieldBase & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "className">;

export function Textarea({ id, label, hint, error, className, controlClassName, "aria-describedby": extra, ...props }: TextareaProps) {
  return <FieldShell id={id} label={label} hint={hint} error={error} className={className}>
    <textarea id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error, extra)} className={cx(controlClass(Boolean(error)), "min-h-28 resize-y", controlClassName)} {...props} />
  </FieldShell>;
}

export type SelectProps = FieldBase & Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "className">;

export function Select({ id, label, hint, error, className, controlClassName, "aria-describedby": extra, children, ...props }: SelectProps) {
  return <FieldShell id={id} label={label} hint={hint} error={error} className={className}>
    <select id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error, extra)} className={cx(controlClass(Boolean(error)), "cursor-pointer", controlClassName)} {...props}>
      {children}
    </select>
  </FieldShell>;
}
