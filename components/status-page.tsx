import type { ReactNode } from "react";

/**
 * Shared layout of the 404 and error pages (DESIGN-T9): icon in a soft circle, kicker, Fraunces title, text and the
 * page's own buttons. No hooks, so the client error panel and the server 404 page can both use it. `landmark`: the
 * stand-alone pages (404, root and global error) are the page's <main>; inside the site layout, which already has
 * <main>, it is a plain <div>.
 */
export function StatusPage({ icon, kicker, title, children, actions, footnote, landmark = true, role, ariaLive }: {
  icon: ReactNode;
  kicker: string;
  title: string;
  children: ReactNode;
  actions: ReactNode;
  footnote?: ReactNode;
  landmark?: boolean;
  role?: "alert";
  ariaLive?: "assertive";
}) {
  const Root = landmark ? "main" : "div";
  return <Root data-status-page="" role={role} aria-live={ariaLive} className="grid min-h-[60vh] place-items-center bg-surface-page px-4 py-16 text-center">
    <div className="max-w-md">
      <span aria-hidden="true" className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-primary-subtle text-primary ring-1 ring-inset ring-brand-100">{icon}</span>
      <p className="mt-5 text-kicker uppercase text-gold-700">{kicker}</p>
      <h1 className="mt-2 font-display text-h1 text-fg">{title}</h1>
      <p className="mt-3 text-body leading-7 text-fg-secondary">{children}</p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">{actions}</div>
      {footnote}
    </div>
  </Root>;
}
