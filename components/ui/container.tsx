import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export type ContainerProps = HTMLAttributes<HTMLDivElement> & {
  /** default: the site's 1440 px `.container`; narrow: 768 px content column; form: 512 px (auth and short forms). */
  width?: "default" | "narrow" | "form";
};

const WIDTH = { default: "", narrow: "max-w-3xl", form: "max-w-lg" } as const;

/** Page-width wrapper with the site gutters (28 px, 14 px on phones). */
export function Container({ width = "default", className, ...props }: ContainerProps) {
  return <div className={cx("container", WIDTH[width], className)} {...props} />;
}

export type SectionProps = HTMLAttributes<HTMLElement> & {
  /** Vertical rhythm: sm 32/40 px, md 40/56 px (pages), lg 56/80 px (home sections). */
  spacing?: "sm" | "md" | "lg";
  as?: "section" | "div";
};

const SPACING = { sm: "py-8 sm:py-10", md: "py-10 sm:py-14", lg: "py-14 sm:py-20" } as const;

export function Section({ spacing = "md", as: Tag = "section", className, ...props }: SectionProps) {
  return <Tag className={cx(SPACING[spacing], className)} {...props} />;
}
