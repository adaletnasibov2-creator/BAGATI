# Database connection pool (Prisma)

BAGATI talks to PostgreSQL through one Prisma client per Node process (`lib/prisma.ts`). The client keeps a pool of
connections. **The pool size and wait time are set only in `DATABASE_URL`; the code does not set them.** This page
explains the two settings and what to measure on the server before choosing values.

## The two settings

Append them as query parameters to the production `DATABASE_URL` (in the server's environment, never in the repo):

```
postgresql://USER:PASSWORD@HOST:5432/DBNAME?schema=public&connection_limit=10&pool_timeout=10
```

| Parameter | Meaning | Default when not set |
|---|---|---|
| `connection_limit` | Most connections this process opens to PostgreSQL. | `number of physical CPUs × 2 + 1`, as Prisma sees them on the server. **On a 2-vCPU server that is 5.** |
| `pool_timeout` | Seconds a query waits for a free connection before it fails with `P2024`. `0` = wait forever (do not use). | 10 |

Rules:

- **Total connections = `connection_limit` × number of app processes** (PM2 instances, plus any separate worker or
  cron process that uses Prisma). This total must stay below PostgreSQL's `max_connections`. Leave room for
  superuser-reserved connections, backups, migrations and admin tools (psql).
- A bigger pool does not make PostgreSQL faster. Past the number of CPU cores PostgreSQL can use, extra connections
  only queue inside the database instead of inside Prisma. On a small server, 2–4 × the database's vCPUs is a sensible
  upper range.
- A shorter `pool_timeout` (for example 5 s) makes an overloaded server answer with an error sooner instead of after
  10 s. That frees the visitor and the Node process sooner, but it does not add capacity.

## What the scale audit showed (local machine, not production)

`release-output/scale-audit-report.md` (12-core local machine, default pool 17):

- Under load, every 5xx came from pool exhaustion, not from database errors:
  - `P2024 Timed out fetching a new connection from the connection pool (connection limit: 17)`
  - `Unable to start a transaction in the given time`
- Listing pages reached their throughput ceiling at about 5 concurrent requests. Beyond that, requests queued for
  connections.
- With the CPU-based default, the same code on a 2-vCPU server would get a pool of 5 and start queueing earlier.
  This was not measured.

`release-output/scale-fixes-1-report.md` has the numbers after the first fixes.

## Error codes

| Code / message | Meaning | First thing to check |
|---|---|---|
| `P2024` "Timed out fetching a new connection from the connection pool" | All `connection_limit` connections were busy for `pool_timeout` seconds. | Slow queries holding connections; traffic spike; pool too small for the traffic. |
| `P2028` "Transaction already closed" / "Unable to start a transaction in the given time" | An interactive `$transaction` waited too long for a connection (`maxWait`, default 2 s) or ran longer than its `timeout` (default 5 s). | The same pool pressure, or a slow query inside the transaction. |
| PostgreSQL "sorry, too many clients already" | The total across all processes went above `max_connections`. | `connection_limit` × processes is too high. |

## What to measure on Cloudways first

Do this on the production server (read-only commands), or better on a staging copy on the same plan. **Do not load-test
the live shop.**

1. **CPU and memory.** `nproc` (vCPUs), `free -m` (RAM headroom), and `cat /proc/cpuinfo | grep "model name" | head -1`.
   The plan has 3.82 GB RAM; the vCPU count is not known yet.
2. **Where PostgreSQL runs.** On the same server (it then shares the CPUs and RAM with Node) or as a managed service.
3. **PostgreSQL limits**, in psql:
   ```sql
   SHOW max_connections;
   SHOW shared_buffers;
   SELECT count(*) FROM pg_stat_activity;                                  -- connections in use now
   SELECT usename, application_name, count(*) FROM pg_stat_activity GROUP BY 1, 2;  -- who holds them
   ```
4. **Processes.** `pm2 ls`: how many BAGATI instances run (fork or cluster mode), and any other Node process using
   the same database.
5. **The pool in effect today.** Check whether the production `DATABASE_URL` already has `connection_limit`. If not,
   the default above applies (5 on 2 vCPU).
6. **A short load run on staging** at 1, 5, 10 and 25 concurrent visitors (`scripts/scale-audit/load.mjs` shows the
   method; it refuses any database other than the local verify cluster, so a staging run needs its own copy pointed at
   staging). Record p50/p95, error rate, `P2024` count in the log, server CPU and memory.

## Choosing values (after measuring)

- Start from `connection_limit` = 2–3 × the database vCPUs, and check:
  `connection_limit × app processes + 5 (reserve) < max_connections`.
- Keep `pool_timeout` at 10, or lower it to 5 once the pages are fast enough that a 5 s wait really means overload.
- Change one value at a time, repeat the staging run, and compare. Note that the in-process category cache
  (`lib/public-category-tree.ts`) assumes one PM2 process; read its comment before switching to cluster mode.

## Several app processes (MULTI-PROCESS-1)

`npm run start:cluster` with `BAGATI_WORKERS=N` runs N app processes (`docs/multi-process.md`). Each process has its
own pool, and each process also opens **one extra connection** for the email outbox lock when
`EMAIL_WORKER_ENABLED=true` (`lib/email-worker-runtime.ts`).

Total connections = N × (`connection_limit` + 1) + admin tools.

| App processes | `connection_limit` per process | Total (incl. email lock) | Notes |
|---|---|---|---|
| 1 | 10 | 11 | today |
| 2 | **8** | 18 | recommended first step on the 4-vCPU server |
| 3 | **6** | 21 | only if 2 processes still run hot on CPU and RAM allows |

Keep `pool_timeout=10`. These totals stay far below PostgreSQL's default `max_connections` (100); the real limit is
the CPU that PostgreSQL shares with Node on the same server (2–4 × vCPUs). The start-up line
`{"event":"db_pool",...,"pid":...,"worker":"1"}` appears once per process in the PM2 log and shows the value in effect.
