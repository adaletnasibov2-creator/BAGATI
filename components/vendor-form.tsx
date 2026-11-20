import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * Seller-panel form pieces (SELLER-DESIGN-2). Only styling: every form keeps its own fields, names, handlers,
 * validation and texts. No hooks, so server and client components can use them.
 */

/**
 * Text input / select / textarea in the seller forms: 48 px tall, 12 px radius, token border, green focus ring.
 * The error state follows the browser's own validation after the seller has typed (`:user-invalid`) and
 * `aria-invalid`, so required fields show a red border next to the field without any new logic.
 */
export const vendorInput = cx(
  "block w-full min-h-12 rounded-control border border-line-strong bg-white px-3.5 py-2.5 text-sm text-fg placeholder:text-fg-muted",
  "transition-colors duration-150 hover:border-primary focus:border-primary motion-reduce:transition-none",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
  "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:opacity-70",
  "aria-[invalid=true]:border-danger [&:user-invalid]:border-danger",
);
/** Multi-line variant: same look, room for 4 lines. */
export const vendorTextarea = cx(vendorInput, "min-h-28 resize-y");
/** Label wrapper: the label text, then the control, then optional help (`vendorHint`). */
export const vendorLabel = "grid min-w-0 gap-1.5 text-sm font-medium text-fg";
/** Help text under a control: readable size and contrast (muted green #56706a in the seller scope). */
export const vendorHint = "text-xs font-normal leading-5 text-fg-muted";
/** "(istəyə bağlı)" and similar notes inside a label. */
export const vendorOptional = "text-xs font-normal text-fg-muted";
/** Inline message under a field or block (keeps role="alert" on the element that uses it). */
export const vendorFieldError = "rounded-control border border-[#f1b9b9] bg-danger-subtle px-3 py-2 text-sm font-medium text-danger";
export const vendorNotice = "rounded-control border border-gold-200 bg-[#faf5ec] px-3 py-2.5 text-sm leading-6 text-gold-700";
/** Native checkbox in the brand colour, 20 px. */
export const vendorCheckbox = "h-5 w-5 shrink-0 cursor-pointer rounded accent-[#174746]";

export type VendorFormSectionProps = {
  title: ReactNode;
  /** Small gold kicker above the title. */
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Right side of the header (a badge or a small action). */
  aside?: ReactNode;
  /** Classes for the body grid, for example "sm:grid-cols-2". */
  bodyClassName?: string;
  className?: string;
  headingLevel?: "h2" | "h3";
  id?: string;
  children: ReactNode;
};

/** One card of a seller form: header (kicker, Fraunces title, one line of help) and a body grid. */
export function VendorFormSection({ title, eyebrow, description, aside, bodyClassName, className, headingLevel: Heading = "h2", id, children }: VendorFormSectionProps) {
  return <section id={id} data-vendor-form-section="" className={cx("min-w-0 rounded-card border border-line bg-white", className)}>
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4 sm:px-7">
      <div className="min-w-0">
        {eyebrow && <p className="text-kicker uppercase text-gold-700">{eyebrow}</p>}
        <Heading className={cx("font-display text-h3 text-fg", Boolean(eyebrow) && "mt-1")}>{title}</Heading>
        {description && <p className="mt-1 max-w-3xl text-sm font-normal text-fg-secondary">{description}</p>}
      </div>
      {aside && <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div>}
    </div>
    <div className={cx("grid gap-5 p-5 sm:p-7", bodyClassName)}>{children}</div>
  </section>;
}

/**
 * Save bar that sticks to the bottom of the window while the form is long, so the buttons stay in reach. It is
 * the form's last child (in normal flow), so at the end of the page it sits below the last field and never covers
 * it. Status and error messages go in `status`, next to the buttons.
 */
export function VendorStickyActions({ children, status, className }: { children: ReactNode; status?: ReactNode; className?: string }) {
  return <div data-vendor-sticky-actions="" className={cx(
    "sticky bottom-0 z-10 -mx-4 border-t border-line bg-white/95 px-4 py-3 shadow-[0_-8px_24px_rgba(23,58,58,0.08)] backdrop-blur",
    "sm:-mx-7 sm:px-7 lg:-mx-9 lg:px-9 xl:-mx-10 xl:px-10",
    className,
  )}>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 sm:flex-1" aria-live="polite">{status}</div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">{children}</div>
    </div>
  </div>;
}
