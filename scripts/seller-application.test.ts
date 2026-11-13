import assert from "node:assert/strict";
import test from "node:test";
import {
  type ApplicationHistoryItem,
  isOpenApplication,
  isValidNewVoen,
  maskVoen,
  normalizeVoen,
  reapplyDecision,
  SELLER_APPLICATION_RULES,
  sellerApplicationInputSchema,
  sellerApplicationIssue,
  sellerApplicationReviewSchema,
} from "../lib/seller-application";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = new Date("2026-11-13T12:00:00.000Z");
const at = (msAgo: number) => new Date(now.getTime() - msAgo);
const item = (status: ApplicationHistoryItem["status"], createdAgo: number, closedAgo: number | null = null, source: ApplicationHistoryItem["source"] = "SELF"): ApplicationHistoryItem => ({
  status,
  source,
  createdAt: at(createdAgo),
  reviewedAt: status === "REJECTED" || status === "APPROVED" ? at(closedAgo ?? createdAgo) : null,
  withdrawnAt: status === "WITHDRAWN" ? at(closedAgo ?? createdAgo) : null,
});

const valid = {
  displayName: "Aysel Store",
  phone: "055 123 45 67",
  sellerType: "INDIVIDUAL_ENTREPRENEUR",
  legalName: "Aysel Məmmədova",
  voen: "1234 567 890",
};

test("VÖEN is normalized to digits and must have exactly 10 digits for new applications", () => {
  assert.equal(normalizeVoen(" 12 345-678 90 "), "1234567890");
  assert.equal(normalizeVoen("abc"), null);
  assert.equal(normalizeVoen(null), null);
  assert.equal(isValidNewVoen("1234567890"), true);
  assert.equal(isValidNewVoen("123456789"), false);
  assert.equal(isValidNewVoen("12345678901"), false);
  assert.equal(isValidNewVoen("AZ1234567890"), true, "letters are dropped, 10 digits remain");
  assert.equal(maskVoen("1234567890"), "•••••••890");
  assert.equal(maskVoen(null), "—");
});

test("application input: valid data is normalized; VÖEN, phone and company address are enforced", () => {
  const parsed = sellerApplicationInputSchema.parse({ ...valid, applicantNote: "  ", plannedStoreName: " Aysel " });
  assert.equal(parsed.voen, "1234567890");
  assert.equal(parsed.phone, "+994551234567");
  assert.equal(parsed.applicantNote, null);
  assert.equal(parsed.plannedStoreName, "Aysel");
  assert.equal(parsed.legalAddress, null);

  const shortVoen = sellerApplicationInputSchema.safeParse({ ...valid, voen: "123456789" });
  assert.equal(shortVoen.success, false);
  assert.equal(sellerApplicationIssue(shortVoen.error!), "VÖEN 10 rəqəmdən ibarət olmalıdır.");

  const badPhone = sellerApplicationInputSchema.safeParse({ ...valid, phone: "12" });
  assert.equal(badPhone.success, false);
  assert.match(sellerApplicationIssue(badPhone.error!), /Azərbaycan formatında/);

  const company = sellerApplicationInputSchema.safeParse({ ...valid, sellerType: "REGISTERED_COMPANY" });
  assert.equal(company.success, false);
  assert.equal(sellerApplicationIssue(company.error!), "Qeydiyyatdan keçmiş şirkət üçün hüquqi ünvan tələb olunur.");
  assert.equal(sellerApplicationInputSchema.safeParse({ ...valid, sellerType: "REGISTERED_COMPANY", legalAddress: "Bakı, Nizami küç. 1" }).success, true);

  const longNote = sellerApplicationInputSchema.safeParse({ ...valid, applicantNote: "x".repeat(SELLER_APPLICATION_RULES.applicantNoteMax + 1) });
  assert.equal(longNote.success, false);
  assert.equal(sellerApplicationInputSchema.safeParse({ ...valid, applicantNote: "x".repeat(SELLER_APPLICATION_RULES.applicantNoteMax) }).success, true);

  assert.equal(sellerApplicationInputSchema.safeParse({ ...valid, role: "VENDOR" }).success, false, "unknown keys such as role are rejected");
  assert.equal(sellerApplicationInputSchema.safeParse({ ...valid, sellerType: "ADMIN" }).success, false);
});

test("review input: reject needs a 10..500 character reason; approve may confirm a duplicate VÖEN", () => {
  assert.equal(sellerApplicationReviewSchema.safeParse({ action: "reject", reason: "short" }).success, false);
  assert.equal(sellerApplicationReviewSchema.safeParse({ action: "reject", reason: "x".repeat(501) }).success, false);
  assert.equal(sellerApplicationReviewSchema.safeParse({ action: "reject" }).success, false);
  const reject = sellerApplicationReviewSchema.parse({ action: "reject", reason: "  VÖEN sənədi uyğun deyil  " });
  assert.equal(reject.action === "reject" && reject.reason, "VÖEN sənədi uyğun deyil");
  const approve = sellerApplicationReviewSchema.parse({ action: "approve" });
  assert.equal(approve.action === "approve" && approve.confirmDuplicateVoen, false);
  assert.equal(sellerApplicationReviewSchema.safeParse({ action: "approve", role: "ADMIN" }).success, false);
  assert.equal(sellerApplicationReviewSchema.safeParse({ action: "delete" }).success, false);
});

test("reapply: first application allowed; never while one is open or after approval", () => {
  assert.deepEqual(reapplyDecision([], now), { allowed: true });
  assert.deepEqual(reapplyDecision([item("PENDING", HOUR)], now), { allowed: false, reason: "OPEN" });
  assert.deepEqual(reapplyDecision([item("APPROVED", DAY, null, "LEGACY")], now), { allowed: false, reason: "APPROVED" });
});

test("reapply: 24 hours after a rejection or a withdrawal", () => {
  const rejected = reapplyDecision([item("REJECTED", 2 * DAY, 23 * HOUR)], now);
  assert.equal(rejected.allowed, false);
  assert.equal(!rejected.allowed && rejected.reason, "WAIT");
  assert.equal(!rejected.allowed && "nextAllowedAt" in rejected && rejected.nextAllowedAt.toISOString(), new Date(now.getTime() + HOUR).toISOString());
  assert.deepEqual(reapplyDecision([item("REJECTED", 2 * DAY, 24 * HOUR)], now), { allowed: true }, "exactly 24 hours later is allowed");
  const withdrawn = reapplyDecision([item("WITHDRAWN", 2 * HOUR, HOUR)], now);
  assert.equal(!withdrawn.allowed && withdrawn.reason, "WAIT");
  // The wait counts from the LAST closed application.
  const latest = reapplyDecision([item("REJECTED", 5 * DAY, 4 * DAY), item("WITHDRAWN", 3 * HOUR, 2 * HOUR)], now);
  assert.equal(!latest.allowed && "nextAllowedAt" in latest && latest.nextAllowedAt.getTime(), now.getTime() + 22 * HOUR);
});

test("reapply: at most 3 customer applications in a rolling 30 days", () => {
  const three = [item("REJECTED", 20 * DAY, 19 * DAY), item("WITHDRAWN", 10 * DAY, 9 * DAY), item("REJECTED", 3 * DAY, 2 * DAY)];
  const limited = reapplyDecision(three, now);
  assert.equal(!limited.allowed && limited.reason, "LIMIT");
  // Allowed again when the oldest of the three leaves the window: 20 days ago + 30 days = in 10 days.
  assert.equal(!limited.allowed && "nextAllowedAt" in limited && limited.nextAllowedAt.getTime(), now.getTime() + 10 * DAY);
  assert.deepEqual(reapplyDecision(three, new Date(now.getTime() + 10 * DAY + 1)), { allowed: true });
  // Applications older than 30 days and ADMIN/LEGACY rows do not count.
  assert.deepEqual(reapplyDecision([item("REJECTED", 40 * DAY, 39 * DAY), item("REJECTED", 10 * DAY, 9 * DAY), item("WITHDRAWN", 5 * DAY, 4 * DAY)], now), { allowed: true });
  // Four inside the window (possible only if rules changed): the second oldest must expire.
  const four = [item("REJECTED", 25 * DAY, 24 * DAY), item("REJECTED", 20 * DAY, 19 * DAY), item("REJECTED", 15 * DAY, 14 * DAY), item("REJECTED", 5 * DAY, 4 * DAY)];
  const fourDecision = reapplyDecision(four, now);
  assert.equal(!fourDecision.allowed && "nextAllowedAt" in fourDecision && fourDecision.nextAllowedAt.getTime(), now.getTime() + 10 * DAY);
});

test("reapply: when the 24 hour wait and the 30 day limit both apply, the later time wins", () => {
  const both = reapplyDecision([item("REJECTED", 29 * DAY, 28 * DAY), item("REJECTED", 2 * DAY, DAY + HOUR), item("WITHDRAWN", 2 * HOUR, HOUR)], now);
  assert.equal(!both.allowed && both.reason, "LIMIT");
  assert.equal(!both.allowed && "nextAllowedAt" in both && both.nextAllowedAt.getTime(), now.getTime() + DAY);
  const waitLater = reapplyDecision([item("REJECTED", 29 * DAY + 23 * HOUR, 29 * DAY), item("REJECTED", 2 * DAY, DAY + HOUR), item("WITHDRAWN", 2 * HOUR, HOUR)], now);
  assert.equal(!waitLater.allowed && waitLater.reason, "WAIT");
});

test("only PENDING applications are open", () => {
  assert.equal(isOpenApplication("PENDING"), true);
  for (const status of ["APPROVED", "REJECTED", "WITHDRAWN"] as const) assert.equal(isOpenApplication(status), false);
});
