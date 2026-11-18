import Link from "next/link";
import type { ComponentProps } from "react";
import { cx, focusRing, focusRingInverse } from "./cx";

type TextLinkStyle = {
  /** default: primary green on light surfaces (#174746, 10.36:1 on white); inverse: light text on the dark footer. */
  tone?: "default" | "inverse";
  underline?: boolean;
};

export function textLinkClass({ tone = "default", underline = true }: TextLinkStyle = {}): string {
  return cx(
    "rounded-sm transition-colors duration-150 motion-reduce:transition-none",
    tone === "inverse" ? cx("text-white/70 hover:text-white", focusRingInverse) : cx("font-medium text-primary hover:text-primary-hover", focusRing),
    underline && "underline decoration-1 underline-offset-[3px] hover:decoration-2",
  );
}

export type TextLinkProps = TextLinkStyle & ComponentProps<typeof Link>;

/** Inline link in running text, or a plain list link (footer). */
export function TextLink({ tone, underline, className, ...props }: TextLinkProps) {
  return <Link className={cx(textLinkClass({ tone, underline }), className)} {...props} />;
}
