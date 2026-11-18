import Link from "next/link";

type ConsentLink = { href: "/terms" | "/privacy" | "/seller-terms"; label: string };

/**
 * The consent checkbox used on registration, checkout, the seller application and the seller panel card.
 * The links open in a new tab so the form keeps what the user typed. The error is tied to the box with
 * aria-describedby so a screen reader reads it with the checkbox.
 */
export function LegalConsentCheckbox({ id, checked, onChange, error, parts }: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
  /** Sentence pieces: plain strings and links, rendered in order. */
  parts: (string | ConsentLink)[];
}) {
  const errorId = `${id}-error`;
  return <div>
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 text-sm leading-6 text-ink">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="mt-1 h-5 w-5 shrink-0 cursor-pointer rounded border-line accent-[#174746]"
      />
      <span>{parts.map((part, index) => typeof part === "string"
        ? <span key={index}>{part}</span>
        : <Link key={index} href={part.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald underline underline-offset-2">{part.label}</Link>)}</span>
    </label>
    {error && <p id={errorId} role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </div>;
}

/** "İstifadəçi şərtləri və Məxfilik siyasəti ilə tanış oldum və razıyam" (owner's wording, Phase B brief). */
export const CUSTOMER_CONSENT_PARTS: (string | ConsentLink)[] = [
  { href: "/terms", label: "İstifadəçi şərtləri" },
  " və ",
  { href: "/privacy", label: "Məxfilik siyasəti" },
  " ilə tanış oldum və razıyam",
];

/** "Satıcı şərtləri ilə tanış oldum və razıyam" (same form as the customer sentence). */
export const SELLER_CONSENT_PARTS: (string | ConsentLink)[] = [
  { href: "/seller-terms", label: "Satıcı şərtləri" },
  " ilə tanış oldum və razıyam",
];
