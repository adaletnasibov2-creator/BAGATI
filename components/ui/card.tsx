import type { HTMLAttributes, Ref } from "react";
import { cx } from "./cx";

type CardTag = "div" | "section" | "article" | "aside" | "li";
type CardPadding = "none" | "sm" | "md" | "lg";
type CardTone = "raised" | "sunken";
type CardElevation = "none" | "subtle" | "card" | "overlay";

export type CardStyle = {
  padding?: CardPadding;
  /** raised: white (default); sunken: the soft section green, for grouped content inside a card. */
  tone?: CardTone;
  elevation?: CardElevation;
  /** Hover lift and stronger shadow, for a card that is one big link or button. */
  interactive?: boolean;
};

const PADDING: Record<CardPadding, string> = { none: "", sm: "p-4", md: "p-5 sm:p-6", lg: "p-6 sm:p-10" };
const TONE: Record<CardTone, string> = { raised: "bg-white", sunken: "bg-surface-page" };
const ELEVATION: Record<CardElevation, string> = { none: "", subtle: "shadow-subtle", card: "shadow-card", overlay: "shadow-overlay" };

export function cardClass({ padding = "md", tone = "raised", elevation = "none", interactive = false }: CardStyle = {}): string {
  return cx(
    "rounded-card border border-line",
    TONE[tone],
    PADDING[padding],
    ELEVATION[elevation],
    interactive && "transition-[transform,box-shadow,border-color] duration-200 ease-out hover:border-brand-200 hover:shadow-card motion-safe:hover:-translate-y-0.5 motion-reduce:transition-none",
  );
}

export type CardProps = CardStyle & HTMLAttributes<HTMLElement> & { as?: CardTag; ref?: Ref<HTMLElement> };

/** Card surface: 20 px radius, hairline border. `ref` is a plain prop (React 19). */
export function Card({ as: Tag = "div", padding, tone, elevation, interactive, className, ...props }: CardProps) {
  // The ref type is the common HTMLElement; every allowed tag accepts it.
  const Element = Tag as "div";
  return <Element className={cx(cardClass({ padding, tone, elevation, interactive }), className)} {...(props as HTMLAttributes<HTMLDivElement> & { ref?: Ref<HTMLDivElement> })} />;
}
