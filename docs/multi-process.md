# Running BAGATI as several processes (owner runbook)

One Node process can only use one CPU core to build pages. The server has 4 vCPUs. With `npm run start:cluster` the
app runs as 2 (or 3) processes that share port 3000, so page building can use more cores. Nothing else changes for
visitors.

It is safe: money, stock, orders, emails and logins are guarded by the database, not by the memory of one process
(`release-output/multi-process-audit-1-report.md`). Two small side effects:

- After an admin saves a setting, the other process may show the old value for up to 30 seconds.
- The anti-flood limits that live in memory become 2× looser. Real limits (login, password, orders, payments) are in
  the database and do not change.

## 1. Lower the database pool (you edit the environment)

In Cloudways Velocity → your app → **Environment variables**, edit `DATABASE_URL` and set
`connection_limit=8` (keep `pool_timeout=10`), for example:

```
...?schema=public&connection_limit=8&pool_timeout=10
```

Change only the number. Why 8: each process gets its own pool, plus one connection for the email lock
(`docs/database-connection-pool.md`). For 3 processes use 6.

## 2. Switch the start command and the number of processes

In Cloudways Velocity → your app → **Settings**:

1. **Start command:** `npm run start:cluster`
2. **Environment variable:** `BAGATI_WORKERS=2`
3. Keep `EMAIL_WORKER_ENABLED=true` as it is. Only one process sends at a time (database lock), so nobody gets an
   email twice.
4. **Redeploy.**

Rules of `BAGATI_WORKERS`: not set, empty, `0` or not a number → 1. More than 4 or more than the CPUs → capped.

## 3. What to check in the PM2 log after the deploy

You should see, within a few seconds:

```
{"event":"cluster_primary_start","pid":1000,"workers":2}
{"event":"cluster_worker_start","worker":1,"pid":1001}
{"event":"cluster_worker_start","worker":2,"pid":1002}
{"event":"db_pool","connection_limit":"8","pool_timeout":"10","source":"DATABASE_URL","cpus":4,"pid":1001,"worker":"1"}
{"event":"db_pool","connection_limit":"8","pool_timeout":"10","source":"DATABASE_URL","cpus":4,"pid":1002,"worker":"2"}
```

- Two `db_pool` lines, two different pids, `connection_limit` `"8"`: correct.
- `cluster_worker_exit` followed by a new `cluster_worker_start`: one process crashed and was restarted (fine once).
- `cluster_restart_limit`: a process crashed 6 times in a minute. The app then stops and PM2 restarts it. Look at the
  error lines above it, and roll back (step 4) if it repeats.
- `cluster_unavailable`: the host already runs the app inside a cluster, so only one process started. Tell me.
- Then open the shop, log in, add to cart, and open the admin panel as usual.

## 4. Roll back (any time)

Either one of these, then **Redeploy**:

- Set `BAGATI_WORKERS=1` (one process, exactly like before), **or**
- Set the start command back to `npm start`.

Then put `connection_limit` back to its old value (10). Nothing in the database changes, so there is nothing else to
undo.

## 5. What to measure (before and after, same time of day)

| What | Where | Expect |
|---|---|---|
| Page response time | Cloudflare → Analytics (origin response time); or open a product page a few times | same or faster; faster under load |
| CPU | Cloudways → Monitoring | load spread over more cores instead of one core near 100 % |
| RAM | Cloudways → Monitoring | each process needs its own memory: watch that free RAM stays comfortable (the plan has 3.82 GB, shared with PostgreSQL) |
| Database connections | Adminer: `SELECT count(*) FROM pg_stat_activity;` | about 2 × 9 plus a few, never near `max_connections` |
| Errors | PM2 log: `P2024`; Security Center: 5xx | no new errors |
| Emails | Admin → Sistem vəziyyəti → E-poçt növbəsi | messages still move from PENDING to SENT |

If RAM gets tight or nothing gets faster, go back to 1 process (step 4).
