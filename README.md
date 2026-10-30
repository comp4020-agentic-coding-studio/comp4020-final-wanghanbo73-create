# Fieldmark

Fieldmark is a storefront built for a streetwear/footwear brand that sells in
**limited drops**: a numbered run of a product goes live at a fixed time, in
small quantities, to a crowd that knows the exact minute it unlocks. That's a
different business from a regular shop with always-in-stock inventory, and it
needs different guarantees. Overselling a drop — telling someone "sorry, that's
actually gone" after they've already paid — is the one failure a drop brand
can't afford, since it's the entire reason a customer trusted the site over
just refreshing a reseller page. Fairness during the rush matters too: the
app has to behave the same whether one person or a thousand hit "Buy" at the
exact same instant. Fieldmark exists to prove that case: correct, race-safe
checkout under real concurrent demand, with the moment a drop goes live and
the crowd pressure around it visible on screen, not just happening correctly
somewhere behind the scenes. This page is rendered from `README.md` at
`/readme/` on the running app, so the headings below double as the table of
contents a marker reads there.

## What it does

- **Catalogue.** `/` lists regular, always-in-stock products; `/limited`
  lists upcoming and live drops with a release time, a live anonymous
  "N people viewing this drop" count, and a per-account purchase limit.
  `/products/:slug` shows one product's colour/size options and live stock
  per SKU — for a drop, this page flips itself from "not available yet" to
  a working buy button the moment the release time passes, with no reload,
  via the same real-time layer described below.
- **Accounts.** `/register` and `/login` create and authenticate a customer
  session; every account that registers through the HTTP form is a customer —
  there is no client-reachable path to an admin role. `/orders` and
  `/orders/:id` show a signed-in customer their own order history and nothing
  else's.
- **Checkout, built to survive a rush.** `/checkout` previews a SKU/quantity
  and `/buy` places the order. The price, stock check, release time, and
  per-account limit are all recomputed server-side from the database inside
  one transaction — nothing posted by the client (price, role, limit) is
  trusted, and a hundred simultaneous buyers for the last unit of a drop
  resolve to exactly one winner, never zero and never two. A repeated
  idempotency key returns the existing order instead of creating a
  duplicate, including when two requests for the same key race each other.
  `scripts/simulate-drop-rush.ts` fires a configurable crowd of concurrent
  buyers at a live drop against a running instance and reports whether stock
  was ever oversold — the literal proof-of-concept a brand owner could watch
  run before committing to this architecture.
- **Real-time, everywhere a drop needs it.** Every open browser tab sees
  stock drain, a SOLD OUT state appear, a drop go live, and an order's
  status change within about a second, with no reload. The reason a drop
  specifically needs this: a drop's demand is correlated in time — a crowd
  arrives in the same few seconds a release unlocks, not spread across a
  day — which turns checkout into a queueing problem, not just a
  correctness one. SQLite's one synchronous connection makes the write path
  a single server in the queueing sense: every `/buy` request is processed
  one at a time inside one transaction, so a spike in arrivals becomes a
  queue of waiting requests, not corrupted state, and utilisation of that
  one write path rises toward its limit exactly when a crowd shows up. The
  watcher count and drop-live push below make that queue — and the demand
  behind it — visible on screen instead of asking anyone to take the
  serialisation claim on faith. See
  [`docs/adr/0002-realtime-concurrency.md`](docs/adr/0002-realtime-concurrency.md)
  and [`docs/adr/0004-drop-urgency-signals.md`](docs/adr/0004-drop-urgency-signals.md)
  for exactly what's pushed and why.
- **Admin.** `/admin` (products, stock edits, order status) is only reachable
  by an admin account, seeded from `ADMIN_EMAIL`/`ADMIN_PASSWORD` at boot.
- **AI customer service.** A small floating widget, available on every page
  once signed in, answers catalogue/order questions over a streamed
  `/ai-chat/stream` response. It runs against a local Ollama model (`qwen2.5`)
  in development and a hosted API (DeepSeek or Anthropic) in production,
  switched by the `AI_BACKEND` env var — the 256 MB Fly machine can't host a
  local model, so all backends share one interface rather than one replacing
  another.

## Tech stack

Express 5, `better-sqlite3`, `express-session` with a custom SQLite-backed
store, `csrf-sync` for the synchronizer-token pattern, Node's built-in
`crypto.scrypt` for password hashing, `marked` for rendering this file at
`/readme/`, and hand-written template-literal views — no bundler, no client
framework. The app runs directly as `node src/server.ts`, using Node 24's
native TypeScript stripping. Rationale for each choice is in
[`docs/adr/0001-stack.md`](docs/adr/0001-stack.md).

## Running it locally

```bash
pnpm install
DATA_DIR=./data-dev PORT=8080 ADMIN_EMAIL=admin@example.com \
  ADMIN_PASSWORD=devpassword123 node src/server.ts
```

Then, in another shell:

```bash
pnpm typecheck
APP_URL=http://localhost:8080 pnpm test
```

`DATA_DIR` holds the SQLite file (`app.db`) and is created if missing.
`ADMIN_EMAIL`/`ADMIN_PASSWORD` seed (or re-use, if already present) the one
admin account; without them the app still boots but no admin account exists.
Sessions persist in the same database, so restarting the process does not log
anyone out.

## Running it in Docker

```bash
docker build -t fieldmark .
docker run -d --init --name fieldmark -p 8080:8080 -e PORT=8080 \
  -e ADMIN_EMAIL=admin@example.com -e ADMIN_PASSWORD=devpassword123 \
  --tmpfs /data fieldmark
```

## Tests

Everything in `spec/*.test.ts` runs against a real running instance over
HTTP (`spec/global-setup.ts` locates it; nothing starts or stops a server
in-process). Coverage includes: role hard-coding at registration, access
control on orders and `/admin`, the purchase flow with server-computed totals
and price snapshotting, no-oversell under concurrent buyers, idempotency-key
deduplication, and limited-release release-time/per-account-limit
enforcement — each written to resist a client that lies about its own role,
price, or limit. `spec/limited-drop-rush.test.ts` combines both concurrency
invariants against a live drop specifically: no oversell and a held
per-account limit when several buyers (and one buyer firing several requests)
race each other at once.

For a demo rather than an assertion, `scripts/simulate-drop-rush.ts` runs the
same kind of concurrent rush against a running instance and prints a summary
(orders placed, rejections, final stock) instead of a pass/fail — meant to be
run live, side by side with `/limited` and the admin order queue open, while
stock visibly drains to zero and never below it.
