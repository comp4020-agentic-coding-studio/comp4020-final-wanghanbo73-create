# Process overview

This describes how Fieldmark — the storefront app in this repo — went from
the final project brief to a running, tested implementation, and what's still
left for me to do by hand before submission.

## Starting point

The brief asks for a small e-commerce app with real access control and real
inventory correctness, deployed on the course's Fly setup, with the harness
(`spec/invariants.test.ts`, `fly.toml`'s machine/volume shape, the CI
workflow) left as the fixed contract and everything else — stack, schema,
views, routes — mine to decide.

Before writing any application code, I worked with Claude to produce a single
written plan covering: the full tech-stack decision (Express 5,
`better-sqlite3`, `express-session` with a custom SQLite-backed store,
`csrf-sync`, Node's built-in `crypto.scrypt`, `marked`, hand-written
template-literal views, no bundler — the app runs as `node src/server.ts`
using Node 24's native TypeScript stripping); the full database schema
(users, products, skus, orders, order_items, sessions); the complete route
list and what each one guards against; and a verification plan (typecheck,
spec tests against the real running app, a Docker build matching CI, and a
Fly deploy). Deciding the stack and the invariants up front, before any code
existed, meant the implementation step was mostly mechanical — and meant I
had something concrete to check the generated code against, rather than
reviewing it against vibes.

## Implementation

I then had Claude implement the plan directly against this repo: the DB
layer and seed data, auth (password hashing, session middleware, CSRF, role
guards), the hand-written views, the catalogue/checkout/orders/admin routes,
`server.ts` wiring, the Dockerfile, and a full `spec/*.test.ts` suite
exercising the invariants the brief cares about — role hard-coding at
registration, ownership checks on orders and `/admin`, server-computed
pricing and stock on `/buy`, no-oversell under concurrent purchases,
idempotency-key deduplication on repeated submits, and release-time/
per-account-limit enforcement on limited drops.

Two things from that pass are worth recording because they're the kind of
bug that only shows up once you run the thing, not while reading the plan:

- **Express 5 router mounting.** `admin.ts`'s router called
  `router.use(requireAdmin)` with no path prefix, and was itself mounted with
  `app.use(adminRouter)` — also with no prefix. Express applies an
  un-prefixed router's own middleware to *every* request that reaches it,
  regardless of which route inside it eventually matches, so `requireAdmin`
  was silently gating unrelated routes like `/readme/` that happened to be
  registered after the admin router. The fix was to give the admin routes
  relative paths (`/`, `/products`, `/orders/:id/status`, …) and mount the
  router at `app.use("/admin", adminRouter)` instead of bare `app.use`.
- **DATA_DIR inside the container.** `src/db.ts` defaults to `./data` when
  `DATA_DIR` isn't set. `fly.toml` mounts the persistent volume at `/data`,
  but the Dockerfile never set `DATA_DIR=/data`, so a deployed container
  would have quietly written its SQLite file to `/app/data` — inside the
  image's writable layer, not the volume — and lost every order and stock
  change on the next redeploy. Caught by re-reading the Dockerfile against
  `fly.toml`'s comment about what `/data` is for, not by a failing test.

## Verification

`pnpm typecheck` runs clean under `strict: true` with
`verbatimModuleSyntax: true`. The full spec suite — the untouched
`spec/invariants.test.ts` plus six new files (`auth`, `access-control`,
`purchase`, `inventory`, `idempotency`, `limited-sale`) — passed in full
against the app started with `DATA_DIR=./data-dev PORT=8080
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=devpassword123 node
src/server.ts`, and stayed green on a second run without resetting the
database, which matters because the suite deliberately shares one
non-reset SQLite file the way the deployed app would across redeploys. Three
rounds of test flakiness during that work each had a distinct cause worth
naming rather than papering over: colliding customer emails generated from a
per-file counter (fixed by generating each test account's email from
`crypto.randomUUID()`), spec files racing each other for the same shared
product stock when Vitest ran them in parallel (fixed by setting
`fileParallelism: false` in `vitest.config.ts`, which the brief leaves open
to edit), and a stock-exhaustion false negative from an earlier local run
having already drained a SKU the concurrency test needed at a specific
count (fixed with a small admin-login-and-restock helper the test calls
before it depends on exact stock numbers).

- TODO (author): Docker build/run verification against the exact CI
  sequence, and the Fly deploy itself, happen after this file is written —
  record the outcome and commit links here once that's done.

## Stack rationale

The reasoning behind each stack choice — why `better-sqlite3` over an async
driver, why a hand-rolled session store instead of a library default, why no
bundler — is written up separately in
[`docs/adr/0001-stack.md`](docs/adr/0001-stack.md) rather than repeated here.

## What's mine to still add

- TODO (author): commit links for the work described above, once committed
  and pushed, in the `[`sha`](...)` form `check:evidence` looks for.
- TODO (author): anything about working with an agent on this brief that
  isn't captured by the mechanical account above — what I'd have done
  differently, what I didn't fully understand before I saw it run, and
  anything that surprised me about where the agent's output needed
  correcting versus where it didn't.
