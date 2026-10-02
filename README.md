# Fieldmark

Fieldmark is a small storefront for a clothing/footwear brand. Customers
browse regular and limited-release products, pick a colour/size SKU, and buy
it; an admin manages the catalogue, stock levels, and order status. This page
is rendered from `README.md` at `/readme/` on the running app, so the headings
below double as the table of contents a marker reads there.

## What it does

- **Catalogue.** `/` lists regular products; `/limited` lists limited-release
  drops with a release time and a per-account purchase limit. `/products/:slug`
  shows one product's colour/size options and live stock per SKU.
- **Accounts.** `/register` and `/login` create and authenticate a customer
  session; every account that registers through the HTTP form is a customer —
  there is no client-reachable path to an admin role. `/orders` and
  `/orders/:id` show a signed-in customer their own order history and nothing
  else's.
- **Checkout.** `/checkout` previews a SKU/quantity and `/buy` places the
  order. The price, stock check, and per-account limit are all recomputed
  server-side from the database inside one transaction — nothing posted by
  the client (price, role, limit) is trusted. A repeated idempotency key
  returns the existing order instead of creating a duplicate.
- **Admin.** `/admin` (products, stock edits, order status) is only reachable
  by an admin account, seeded from `ADMIN_EMAIL`/`ADMIN_PASSWORD` at boot.

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
price, or limit.
