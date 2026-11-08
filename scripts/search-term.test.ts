import assert from "node:assert/strict";
import test from "node:test";
import { normalizePublicSearchTerm } from "../lib/search-term";

test("empty and whitespace-only search terms become no filter", () => {
  assert.deepEqual(normalizePublicSearchTerm(undefined, 120), { value: undefined, tooLong: false });
  assert.deepEqual(normalizePublicSearchTerm("  \t ", 120), { value: undefined, tooLong: false });
});

test("normal search terms are trimmed and preserved", () => {
  assert.deepEqual(normalizePublicSearchTerm("  linen shirt  ", 120), { value: "linen shirt", tooLong: false });
});

test("oversized search terms are rejected without passing any search text downstream", () => {
  const result = normalizePublicSearchTerm("x".repeat(121), 120);
  assert.deepEqual(result, { value: undefined, tooLong: true });
});

test("invalid server-side limits fail explicitly", () => {
  assert.throws(() => normalizePublicSearchTerm("x", 0), { message: "SEARCH_TERM_LIMIT_INVALID" });
});
