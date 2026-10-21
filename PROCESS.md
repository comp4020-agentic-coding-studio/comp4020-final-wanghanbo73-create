# Process overview

This describes Fieldmark — the storefront in this repo — as it stands now,
not a log of every step taken to get here. It's rewritten at each crit
rather than appended to, so commit links below are citations for specific
claims, not a full history.

## Approach

Before any application code existed, I worked with Claude to produce a
written plan: the stack decision, the database schema, the route list and
what each route guards against, and a verification plan (typecheck,
HTTP-level spec tests against the real running app, a Docker build matching
CI, a Fly deploy). Deciding the invariants up front gave me something
concrete to check generated code against, rather than reviewing on vibes.
Each later crit followed the same shape — read the existing codebase and the
crit brief, have Claude propose a plan, approve or redirect it in plan mode,
then implement — rather than iterating code first and explaining it after.

## Architecture, and why it's "good" here

The stack (Express 5, `better-sqlite3`, `express-session` with a custom
SQLite-backed store, `csrf-sync`, Node's `crypto.scrypt`, hand-written
template-literal views, no bundler) is reasoned about in
[`docs/adr/0001-stack.md`](docs/adr/0001-stack.md). Short version: the
deploy has exactly one Fly machine, one volume, no separate DB service, so
SQLite's synchronous API turns "check stock, decrement, insert order" into
a single `db.transaction(...)` call with no `await` inside it — the native
binding serialises that against every other request on the same connection,
the entire no-oversell guarantee, with no application-level locking to get
wrong.

Real-time push (Crit 9) is Server-Sent Events over an in-process pub/sub hub
(`src/realtime.ts`), with `publish(...)` calls placed immediately after each
`db.transaction(...)` commits — never inside it, never built from
request-body values. The one concurrency decision this required — live push
only patches read-only elements, never writes into an open form — is in
[`docs/adr/0002-realtime-concurrency.md`](docs/adr/0002-realtime-concurrency.md)
([`97270d1`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-wanghanbo73-create/commit/97270d1)).

Multi-user identity (Crit 10) treats a person as an account —
self-registration through the already-linked `/register` page is sufficient
for "nothing but the URL." Access control predates this crit (ownership
checks on orders, `requireAdmin` on `/admin`, server-recomputed price/stock
on `/buy`); Crit 10 added `src/logger.ts`, a dependency-free JSON-line
logger writing one `http.request` line per request plus action events
(`auth.*`, `order.*`, `admin.*`) after the same post-commit point
`publish(...)` already uses, and the write-up of why each access check is
safe, in
[`docs/adr/0003-identity-and-logging.md`](docs/adr/0003-identity-and-logging.md)
([`d3bdb71`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-wanghanbo73-create/commit/d3bdb71)).

## Bugs that only showed up at runtime

Four are worth naming; reading the plan wouldn't have caught them:

- **Express 5 router mounting.** `admin.ts` called `router.use(requireAdmin)`
  with no path prefix and was itself mounted bare, so it silently gated
  unrelated routes registered after it, like `/readme/`. Fixed by mounting
  at `app.use("/admin", adminRouter)` with relative paths.
- **`DATA_DIR` inside the container.** `src/db.ts` defaults to `./data`;
  `fly.toml` mounts the persistent volume at `/data`, but the Dockerfile
  never set `DATA_DIR=/data` — a deployed container would have written its
  SQLite file into the image's writable layer and lost every order on
  redeploy. Caught by re-reading the Dockerfile against `fly.toml`, not by a
  failing test.
- **Logging the wrong path.** `http.request` read `req.path` inside
  `res.on('finish')`, but Express rewrites `req.url` inside a path-prefixed
  sub-router, so a denied `/admin/products` request logged
  `path: "/products"` — correct status, wrong evidence. Caught by sending a
  non-admin session at `/admin/products` and reading the log, not by
  reading the code. Fixed by capturing `req.originalUrl` before `next()`
  runs
  ([`53c5187`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-wanghanbo73-create/commit/53c5187)).
- **Stale `image_path` on a deployed DB.** Seeding is deliberately
  `INSERT OR IGNORE`, so it never touches a row that already exists.
  Replacing the placeholder SVGs with real photos worked locally against a
  fresh DB, but the already-deployed Fly volume's rows still pointed at the
  now-deleted `.svg` paths — broken images in production, fine everywhere
  else. Caught by checking the deployed site, not the spec suite (which
  seeds fresh). Fixed with a one-time migration mirroring
  `migrateOrdersStatusCheck()`'s shape: rewrite `image_path` only for rows
  still on the exact old path, leaving stock, orders, and any admin-edited
  image untouched
  ([`3661c92`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-wanghanbo73-create/commit/3661c92)).

## Verification, as it stands

`pnpm typecheck` is clean under `strict: true` with `verbatimModuleSyntax:
true`. The spec suite — the untouched `spec/invariants.test.ts` plus files
covering auth, access control, purchase, inventory, idempotency, limited
sales, and the AI chat widget — passes against the app started with
`DATA_DIR=./data-dev PORT=8080 ADMIN_EMAIL=... ADMIN_PASSWORD=... node
src/server.ts`, including against a database already carrying state from a
prior run, matching how the deployed app persists across redeploys.
Multi-user behaviour was checked against the deployed app with two
independent cookie jars acting as two separate browser sessions, narrated
entirely from `flyctl logs`: distinct actors from first request, a 404 on
another account's order, a 403 on `/admin` for a non-admin account, each
logged with the correct path and actor. That check is what surfaced the
logging bug above — caught by reading output, not by trusting the code.

## Outside the three crits

Two new products (Street Shorts, Cloud Slides) were added the same way every
seed product is — appended to `SEED_PRODUCTS`, inserted via
`INSERT OR IGNORE`, so a redeploy adds the new rows without touching
existing stock or orders
([`4a5e1aa`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-wanghanbo73-create/commit/4a5e1aa)).

An AI customer-service widget — a floating chat panel, backed by
`POST /ai-chat/stream` — runs a local Ollama model in development and a
hosted API in production behind one `AI_BACKEND`-switched interface, since
production's 256 MB budget can't host a local model. Production runs
DeepSeek rather than Anthropic, added in
[`d86b480`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-wanghanbo73-create/commit/d86b480)
once an Anthropic key wasn't available — DeepSeek's
OpenAI-compatible API reuses the same tool definitions as Ollama, with its
own SSE parsing for the streaming format. It later gained an order-detail
lookup tool, reusing the same not-found/not-mine ownership check as
`GET /orders/:id`, and a server-side return-policy string so the model
states official wording verbatim rather than improvising. Additive to the
brief, not a substitute for any of its three required properties.

The storefront's visual design was also reworked to match a Stitch-generated
mockup — a forest-green/terracotta/linen palette, a Hanken Grotesk + Inter
pairing, restructured hero mosaic, product-card, and badge layout — with
everything the mockup implies but the app doesn't have (search, a cart,
fabricated stats, a newsletter bar) left out rather than faked. The 10
placeholder SVGs were replaced with real photography sourced from the
mockup's own embedded reference images, each one visually checked before
use rather than trusted on its URL or `data-alt` text
([`7e1b568`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-wanghanbo73-create/commit/7e1b568)).

## What's still mine to do by hand

The Crit 9 multi-tab verification (buy-down-to-sold-out reflected live in a
second tab; admin status change reflected on an open customer order page)
and the real two-Chrome-profile run for Crit 10 — narrated live rather than
via the cookie-jar substitute above — still need to happen in person before
submission.
