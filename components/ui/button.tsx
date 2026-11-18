import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { cx, focusRing } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

type ButtonStyle = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Pill shape (the public-site default). `false` gives the 12 px control radius. */
  pill?: boolean;
  fullWidth?: boolean;
};

const VARIANTS: Record<ButtonVariant, string> = {
  // White on #174746 is 10.36:1; on the #23635d hover 6.97:1.
  primary: "bg-primary text-white shadow-subtle hover:bg-primary-hover active:bg-primary-active",
  secondary: "border border-primary bg-white text-primary hover:bg-primary-subtle active:bg-primary-tint",
  ghost: "text-primary hover:bg-primary-subtle active:bg-primary-tint",
  // White on #b91c1c is 6.47:1.
  danger: "bg-danger text-white shadow-subtle hover:bg-danger-hover",
};

// Every size is at least 44 px tall (touch target).
const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-11 px-4 text-sm",
  md: "min-h-12 px-5 text-body",
  lg: "min-h-[3.25rem] px-6 text-body-lg",
};

/** Class string for a button-looking element; also usable on elements the primitives do not cover. */
export function buttonClass({ variant = "primary", size = "md", pill = true, fullWidth = false }: ButtonStyle = {}): string {
  return cx(
    "inline-flex select-none items-center justify-center gap-2 text-center font-semibold",
    "transition-[background-color,border-color,color,box-shadow] duration-150 ease-out motion-reduce:transition-none",
    "disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60",
    focusRing,
    pill ? "rounded-full" : "rounded-control",
    fullWidth && "w-full",
    VARIANTS[variant],
    SIZES[size],
  );
}

function Spinner() {
  return <span aria-hidden="true" className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" />;
}

export type ButtonProps = ButtonStyle & ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Disables the button, sets aria-busy and shows a spinner. */
  loading?: boolean;
  /** Text shown while loading (for example "Yoxlanılır..."); defaults to the normal label. */
  loadingLabel?: ReactNode;
};

/**
 * Button. Works in server and client components (no hooks). `type` defaults to "button", so pass
 * `type="submit"` in forms.
 */
export function Button({ variant, size, pill, fullWidth, loading = false, loadingLabel, disabled, className, children, type = "button", ...props }: ButtonProps) {
  return <button
    type={type}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    className={cx(buttonClass({ variant, size, pill, fullWidth }), className)}
    {...props}
  >
    {loading && <Spinner />}
    {loading && loadingLabel !== undefined ? loadingLabel : children}
  </button>;
}

export type ButtonLinkProps = ButtonStyle & ComponentProps<typeof Link>;

/** The same look on a next/link, for navigation that should read as an action. */
export function ButtonLink({ variant, size, pill, fullWidth, className, ...props }: ButtonLinkProps) {
  return <Link className={cx(buttonClass({ variant, size, pill, fullWidth }), className)} {...props} />;
}
