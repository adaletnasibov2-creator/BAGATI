import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * Shared reading layout for the legal and info pages (DESIGN-T9): Fraunces title, one readable column (~72
 * characters) in a calm card, the `.legal-prose` typography (app/globals.css) and print styles.
 *
 * The document text stays in the page file as JSX children and this component adds NO visible text to /terms,
 * /privacy and /seller-terms: scripts/legal-versions.test.ts hashes all visible text of those pages, and any added
 * text would mean a new legal version (owner decision 2026-11-20: no contents list, no kicker on the legal pages).
 * It only gives each top-level <h2> an anchor id (`#bolme-N`) so a section can be linked.
 */
export function withHeadingAnchors(children: ReactNode): ReactNode[] {
  let index = 0;
  return Children.toArray(children).map((child) => {
    if (!isValidElement(child) || child.type !== "h2") return child;
    index += 1;
    return cloneElement(child as ReactElement<{ id?: string }>, { id: `bolme-${index}` });
  });
}

export function LegalDocument({ title, kicker, children, after }: {
  title: ReactNode;
  /** Only for pages that already show one (the editable help page's "Məlumat"). */
  kicker?: string;
  children: ReactNode;
  /** Shown under the document inside the card (for example the "Son yenilənmə" line of the editable pages). */
  after?: ReactNode;
}) {
  return <div data-legal-document="" className="container py-8 md:py-12">
    <div className="mx-auto grid max-w-[72ch] gap-6">
      <header className="min-w-0">
        {kicker && <p className="text-kicker uppercase text-gold-700">{kicker}</p>}
        <h1 className={cx("break-words font-display text-h1 text-fg", kicker && "mt-2")}>{title}</h1>
      </header>
      <article className="min-w-0 rounded-card border border-line bg-white p-5 shadow-subtle sm:p-8 lg:p-10">
        <div className="legal-prose">{withHeadingAnchors(children)}</div>
        {after}
      </article>
    </div>
  </div>;
}
