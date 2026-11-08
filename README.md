# BAGATI

Foundation for a multi-vendor Azerbaijan marketplace built with Next.js App Router, TypeScript, PostgreSQL, Prisma and Zod. City data is modeled independently; Qazax is the initial launch context and is not a schema restriction.

## Setup

1. Install Node.js 20.9+ and PostgreSQL.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` plus a random `SESSION_SECRET` (32+ characters).
3. Run `npm install`, `npm run db:generate`, `npm run db:push`, `npm run db:seed`, then `npm run dev`.
4. Run `npm run typecheck` and `npm run build` for checks.

The seed creates the real Qazax launch city only; it creates no demo businesses or statistics. Other Azerbaijani cities can be added as City records. Authentication uses bcrypt password hashes and signed, httpOnly session cookies. Never grant authorization based on client-supplied IDs; use `requireStoreAccess` in vendor handlers. Payment is not implemented.
