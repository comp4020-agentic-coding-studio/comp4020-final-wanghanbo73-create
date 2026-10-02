# Your harness

This file is yours, and it arrives empty on purpose. The rules you hold the
agent to are part of what gets marked, so they should be rules you decided on.

Nothing about the template is recorded here. What the repo ships is explained
where it lives --- `fly.toml`, the `Dockerfile`, the CI workflow and
`spec/README.md` each say what they fix --- and the course website publishes the
[final project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/).
What the agent needs to carry from any of it is your call.

## What "good" means for this app

Fieldmark is a small clothing/footwear storefront: customers browse regular
and limited-release products, buy specific colour/size SKUs, and see their
own orders persist; an admin manages products, stock and order status. A
"good" change keeps all of the following true, regardless of what feature
prompted it:

- **Never trust the client for price, role, or stock.** Every `/buy` request
  re-reads the product and SKU from the database inside the transaction and
  recomputes the total server-side. A posted `role`, `price_cents`, or
  `per_account_limit` field is informational noise — discard it. `/register`
  always inserts `role='customer'`; there is no HTTP path that creates an
  admin account.
- **Purchase mutations are one synchronous `db.transaction(...)` call, no
  `await` inside it.** better-sqlite3 runs that transaction to completion on
  the single connection before touching anything else, which is the whole
  no-oversell / no-duplicate-order guarantee. If you add a new way to mutate
  stock or orders, it goes through the same pattern — re-fetch fresh state,
  validate, mutate, insert — inside one transaction callback, not split
  across separate prepared statements with application-level checks in
  between.
- **Idempotency keys are honoured, not just stored.** A repeated
  `idempotency_key` returns the order that already exists for it rather than
  erroring or creating a second row, including when two requests race for
  the same key.
- **Seeding is additive and non-destructive.** `src/db.ts`'s seed step uses
  `INSERT OR IGNORE` keyed by slug / `(product, color, size)` and runs on
  every boot. It must never reset stock, never touch existing orders, and
  never overwrite an admin account that already exists. A redeploy adds
  nothing once the fixtures exist.
- **Ownership checks are server-side and absolute.** `/orders/:id` checks
  `order.user_id === session.user.id` before rendering anything; a 404 for
  someone else's order looks the same whether the order exists or not.
  `/admin/*` rejects non-admins with a plain 403 (not a redirect dressed up
  as content) for anything that looks like an API call, and a login redirect
  for page routes.
- **No secrets in the repo.** `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`SESSION_SECRET`
  are env vars (Fly secrets in prod, local shell env / `mise.local.toml` —
  gitignored — locally). Nothing resembling a password, token, or API key
  gets committed, including in test fixtures or commit messages.
- **Accessibility is not optional polish.** Keyboard-operable controls (real
  `<select>`s, not swatch-only colour pickers), visible focus states, a
  skip-link, `<label for>` on every form input, and status that's conveyed in
  text (SOLD OUT, error notices) as well as colour.

## Process guardrails

- `spec/invariants.test.ts`, `spec/global-setup.ts`, `vitest.config.ts`'s
  `include`, `fly.toml`, and `.github/workflows/checks.yml` are fixed by the
  course harness — don't modify them to make a test pass.
- Every `spec/*.test.ts` file hits the real running app over HTTP (no
  in-test server start/stop) and shares one SQLite-backed DB with every other
  test file — don't assume a pristine DB inside a test; read current state
  before asserting on deltas.
- Run `pnpm typecheck` and `pnpm test` before calling anything done. `tsconfig.json`
  is `"strict": true` with `"verbatimModuleSyntax": true` — use `import type`
  for type-only imports.
