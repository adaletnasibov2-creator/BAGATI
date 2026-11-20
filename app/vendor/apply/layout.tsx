/**
 * /vendor/apply is reached from the customer account menu ("Satıcı müraciəti"), so it gets the same site header,
 * footer, mobile bottom bar and public theme as the account pages (owner decision, DESIGN-T8). The page file stays
 * in app/vendor/apply, so the URL and the seller-entry rules are unchanged.
 */
export { default } from "@/app/(customer)/layout";
