import Link from "next/link";
import type { ReactNode } from "react";
import { AccountNavigation } from "@/components/account-navigation";
import { cx, focusRing } from "@/components/ui/cx";

export type AccountShellProps = {
  /** Page title (Fraunces). */
  title: ReactNode;
  /** Small kicker above the title; defaults to the "Hesabım" link back to the overview. */
  eyebrow?: ReactNode;
  /** One line under the title. */
  description?: ReactNode;
  /** Primary action on the right of the header. */
  action?: ReactNode;
  /** A back link above the kicker (detail pages). */
  back?: ReactNode;
  /** null hides "Mesajlarım" (messaging OFF); a number shows it with the unread badge. */
  messagesUnread: number | null;
  children: ReactNode;
};

/**
 * One layout for every page of the customer account (DESIGN-T7): the account navigation (side column from 1024 px,
 * a row of pills above the content below that), the shared page header and the content column. No data of its own.
 */
export function AccountShell({ title, eyebrow, description, action, back, messagesUnread, children }: AccountShellProps) {
  return <div data-account-shell="" className="container py-8 md:py-12">
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-10">
      <aside className="min-w-0 lg:self-start"><AccountNavigation messagesUnread={messagesUnread}/></aside>
      <div className="min-w-0">
        <AccountPageHeader title={title} eyebrow={eyebrow} description={description} action={action} back={back}/>
        <div className="mt-6 min-w-0">{children}</div>
      </div>
    </div>
  </div>;
}

/** Shared account page header: back link, kicker, Fraunces title, one line of description, action on the right. */
export function AccountPageHeader({ title, eyebrow, description, action, back }: Omit<AccountShellProps, "messagesUnread" | "children">) {
  return <header data-account-page-header="" className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div className="min-w-0">
      {back && <div className="mb-2">{back}</div>}
      <p className="text-kicker uppercase text-gold-700">{eyebrow ?? <Link href="/account" className={cx("rounded-sm hover:text-primary", focusRing)}>Hesabım</Link>}</p>
      <h1 className="mt-1.5 break-words font-display text-h1 text-fg">{title}</h1>
      {description && <p className="mt-1.5 max-w-3xl text-sm text-fg-secondary">{description}</p>}
    </div>
    {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
  </header>;
}

/** White content card used across the account pages. */
export const accountCard = "rounded-card border border-line bg-white p-5 sm:p-6";
