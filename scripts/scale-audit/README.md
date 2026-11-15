# Scale audit tooling (verify cluster only)

Used for `release-output/scale-audit-report.md`. Nothing here runs in production or in the test suites.

- `base.sql`, `products.sql` (`-v from=… -v to=…`), `orders.sql`: fixtures for a scratch schema `scale_audit`
  on the verify cluster (127.0.0.1:5433): 10 eligible stores, 20,000 customers, 3k/10k/50k active products over the
  15/79 category tree (discounts, variants, stock), 5,000 orders. `base.sql` needs `-v pwhash=<bcrypt>` for the two
  test accounts; the password lives only in a local file passed as `SCALE_AUDIT_CREDS`.
- `measure.mjs <label> <out.json>`: 1 cold + 30 warm sequential requests per endpoint (pages, cart API, order creation,
  admin product list) against `next start` on port 3110.
- `explain.mts <label> <out.json>`: EXPLAIN (ANALYZE, BUFFERS) of the exact SQL the app's own functions send.
- `load.mjs <out.json> [seconds]` with `LEVELS=1,5,10,25,100,300`: closed-loop concurrency test; waits for the server
  and database to drain between runs.

Every script refuses to run unless the database URL is the loopback verify cluster on port 5433.
