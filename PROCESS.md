# Process overview

This describes Fieldmark — the storefront in this repo — as it stands now,
not as a log of every step taken to get here. It's rewritten at each crit
rather than appended to, per the brief, so commit links below are citations
for specific claims, not a full history.

## Approach

Before any application code existed, I worked with Claude to produce a
written plan: the full stack decision, the database schema, the complete
route list and what each route guards against, and a verification plan
(typecheck, HTTP-level spec tests against the real running app, a Docker
build matching CI, a Fly deploy). Deciding the stack and the invariants
up front meant implementation was mostly mechanical, and gave me something
concrete to check generated code against rather than reviewing it on vibes.
Each later crit followed the same shape — read the existing codebase and the
crit brief, have Claude propose a plan, approve or redirect it in plan mode,
then implement — rather than iterating code first and explaining it after.

## Architecture, and why it's "good" here

The stack (Express 5, `better-sqlite3`, `express-session` with a custom
SQLite-backed store, `csrf-sync`, Node's `crypto.scrypt`, hand-written
template-literal views, no bundler) is reasoned about in
[`docs/adr/0001-stack.md`](docs/adr/0001-stack.md). The short version: the
deploy has exactly one Fly machine, one volume, no separate DB service, so
SQLite's synchronous API is what turns "check stock, decrement, insert
order" into a single `db.transaction(...)` call with no `await` inside it —
the native binding serialises that against every other request on the same
connection, which is the entire no-oversell guarantee, with no
application-level locking to get wrong.

Real-time push (Crit 9) is Server-Sent Events over an in-process pub/sub hub
(`src/realtime.ts`), with `publish(...)` calls placed immediately after each
`db.transaction(...)` commits — never inside it, never built from
request-body values. The one concurrency decision this required — that live
push only patches read-only elements (stock figures, status badges, the
notification count) and never writes into an open form — is in
[`docs/adr/0002-realtime-concurrency.md`](docs/adr/0002-realtime-concurrency.md).
Landed in [`97270d1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-wanghanbo73-create/commit/97270d1).

Multi-user identity (Crit 10) treats a person as an account — self-registration
through the already-linked `/register` page is sufficient for "nothing but
the URL." Access control predates this crit (ownership checks on orders,
`requireAdmin` on `/admin`, server-recomputed price/stock on `/buy`); what
Crit 10 added was `src/logger.ts`, a dependency-free JSON-line logger writing
one `http.request` line per request plus action events
(`auth.*`, `order.*`, `admin.*`), placed after the same post-commit point
`publish(...)` already uses, and the write-up of why each access check is
safe, in
[`docs/adr/0003-identity-and-logging.md`](docs/adr/0003-identity-and-logging.md).
Landed in [`d3bdb71`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-wanghanbo73-create/commit/d3bdb71).

## Bugs that only showed up at runtime

Three are worth naming because reading the plan wouldn't have caught them:

- **Express 5 router mounting.** `admin.ts` called `router.use(requireAdmin)`
  with no path prefix and was itself mounted with bare `app.use(adminRouter)`.
  Express applies an un-prefixed router's middleware to every request that
  reaches it, so `requireAdmin` was silently gating unrelated routes like
  `/readme/` registered after it. Fixed by giving admin routes relative paths
  and mounting at `app.use("/admin", adminRouter)`.
- **`DATA_DIR` inside the container.** `src/db.ts` defaults to `./data`;
  `fly.toml` mounts the persistent volume at `/data`, but the Dockerfile
  never set `DATA_DIR=/data`, so a deployed container would have written its
  SQLite file into the image's writable layer and lost every order on the
  next redeploy. Caught by re-reading the Dockerfile against `fly.toml`'s
  comment, not by a failing test.
- **Logging the wrong path.** `http.request` originally read `req.path`
  inside `res.on('finish')`. Express rewrites `req.url` (which `req.path`
  views) while a request is inside a path-prefixed sub-router, so a denied
  request to `/admin/products` logged `path: "/products"` — correct status,
  wrong evidence. Caught by deliberately sending a non-admin session at
  `/admin/products` and reading the log tail, not by reading the code. Fixed
  by capturing `req.originalUrl` before `next()` runs.
  ([`53c5187`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-wanghanbo73-create/commit/53c5187))

## Verification, as it stands

`pnpm typecheck` is clean under `strict: true` with `verbatimModuleSyntax:
true`. The spec suite — the untouched `spec/invariants.test.ts` plus files
covering auth, access control, purchase, inventory, idempotency, limited
sales, and the AI chat widget — passes against the app started with
`DATA_DIR=./data-dev PORT=8080 ADMIN_EMAIL=... ADMIN_PASSWORD=... node
src/server.ts`, including against a database that already has state from a
prior run, matching how the deployed app persists across redeploys.
Multi-user behaviour was checked against the deployed app
(`comp4020-final-wanghanbo73-create.fly.dev`) with two independent cookie
jars acting as two separate browser sessions, narrated entirely from
`flyctl logs`: distinct actors from first request onward, a 404 on another
account's order, a 403 on `/admin` for a non-admin account, each logged with
the correct path and actor. That check is what surfaced the logging bug
above — a real bug caught by reading output, not by trusting the code.

## Outside the three crits

Two pieces of work sit outside the Crit 9/10 cycle. First, catalogue
artwork and two new products (Street Shorts, Cloud Slides) were added the
same way every seed product is — appended to `SEED_PRODUCTS`, inserted via
the existing `INSERT OR IGNORE` step, so a redeploy adds the new rows
without touching existing stock or orders
([`4a5e1aa`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-wanghanbo73-create/commit/4a5e1aa)).
Second, an AI customer-service widget: a floating chat panel, mounted once
in `layout()` for every signed-in page, backed by `POST /ai-chat/stream`.
It runs a local Ollama model in development and the Anthropic API in
production behind one `AI_BACKEND`-switched interface, because the
production Fly machine's 256 MB budget can't host a local model — this
follows the same "the deploy shape decides the architecture" reasoning as
ADR 0001. This is additive to the brief, not a substitute for any of its
three required properties (multi-user, real-time, persists), which the
storefront flows above already satisfy independently of it.

## What's still mine to do by hand

The Crit 9 multi-tab verification (buy-down-to-sold-out reflected live in a
second tab, admin status change reflected on an open customer order page)
and the real two-Chrome-profile run for Crit 10 — narrated live rather than
via two `curl` cookie jars, which is what the automated check above
substitutes for non-interactively — still need to happen in person before
submission.
