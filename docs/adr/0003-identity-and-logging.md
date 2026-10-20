# ADR 0003: Identity, server-side access control, and logging

## Status

Accepted.

## Context

Crit 10 requires the deployed app to be demonstrably multi-user: two or more
people, each in their own browser with no shared cookies, act on shared
state, and the app tells them apart. Two things have to be true and written
down, not just working:

1. What each person may see or change is decided **server-side**, with the
   reasoning for that decision recorded in the repo.
2. The server **logs who did what**, durably — readable live via
   `flyctl logs -a <repo>` — not a one-off `console.log` added only for the
   demo.

At the crit, two pod members get only the app's URL, in separate Chrome
profiles, and the narration comes entirely from the log tail. If two people
can't be told apart in the logs, or one can change what should be the
other's, that's the finding this ADR has to make impossible.

## Identity decision: a person is an account

**Decision**: "person" = a row in `users`. Anyone becomes a person by
visiting `/register` — already linked from the home page — and creating an
account with just an email and password. No extra credential or
out-of-band setup is needed, so "only the URL" is sufficient to get in,
satisfying the crit's requirement that nothing beyond the page itself is
needed to participate.

This reuses the role/session model Fieldmark already has (`customer` or
`admin` in `req.session.user`, set in `src/auth.ts` and the login/register
handlers in `src/routes/auth-routes.ts`) rather than inventing a parallel
notion of "visitor" or "pseudonym" for this crit. Two people in separate
Chrome profiles naturally get two separate sessions (cookies aren't shared
across profiles), and as soon as either registers or logs in, the log
stream can name them by account, not just by session.

Visitors who haven't registered yet are still distinguishable from each
other: `actorFromRequest` (`src/logger.ts`) falls back to a truncated
session id for anonymous requests, so two signed-out browsers both sitting
on `/register` don't collapse into one indistinguishable "anon" entry in
the log tail.

### Options considered

- **Pseudonymous, no-account identity** (e.g. a name typed into a cookie).
  Rejected: Fieldmark's shared state that matters — stock, orders — is
  already keyed to a `user_id` with real authentication; adding a second,
  weaker identity concept alongside it would be more surface area for no
  benefit, and would not let the crit demo exercise the actual access-control
  code the rest of the app depends on.
- **Account = person** (chosen). Matches the app's existing data model
  exactly; self-registration already satisfies "nothing but the URL."

## Access control: what's enforced server-side, and where

This is a recap with pointers into the actual enforcement code — the
decisions themselves predate this crit (they were required by `CLAUDE.md`
from the start), but writing down *why each is safe* is this crit's ask.

- **Customers can only ever see their own orders.** `GET /orders/:id`
  (`src/routes/orders.ts`) loads the order by id and then checks
  `order.user_id === session.user.id` before rendering anything; a
  non-owner gets the same 404 as a non-existent order, so the response
  can't be used to tell "exists but not yours" apart from "doesn't exist."
  This is checked on every request, server-side, from `req.session.user` —
  never from anything the client could claim in the URL or a form field.
- **Only admins can manage products, stock, or order status.**
  `requireAdmin` (`src/auth.ts`) gates every route mounted under `/admin`.
  It checks `req.session.user.role`, which is set once at login/registration
  from the `users.role` column — never re-derived from a request body — so
  a customer cannot elevate themselves by posting `role=admin` anywhere;
  `POST /register` hardcodes `role: 'customer'`, and the only path that
  creates an admin account is `POST /admin/admins`, itself behind
  `requireAdmin`.
- **A customer can never buy at a price, stock level, or limit they
  supplied.** `POST /buy` (`src/routes/checkout.ts`) re-reads the product,
  SKU, and the caller's own prior orders from the database inside the
  purchase transaction and makes every decision (price, stock, per-account
  limit, release time) off that re-read state — nothing posted in the
  request body is trusted for anything but *which* SKU/quantity was
  requested.
- **Why this is enough for "shared state, told apart":** every mutation that
  matters (an order, a stock count, a role) is already attributed to
  `req.session.user` at the point it is decided, not guessed from the UI
  state a client happens to show. Two browsers with two different sessions
  therefore cannot accidentally or intentionally act as each other — the
  server has no code path that reads identity from anywhere a client could
  forge it.

## Logging decision

**Decision**: plain JSON-line logging to stdout via `console.log`
(`src/logger.ts`), with no logging library or external service. Fly
captures a machine's stdout, and `mise exec -- flyctl logs -a <repo>` tails
it — this gets a durable, live-readable log for zero added dependencies,
consistent with ADR 0001's "don't add infrastructure the app doesn't need"
stance.

Two layers of events:

- **`http.request`** — one line per request (method, path, status,
  duration, actor), logged from a single middleware in `src/server.ts`
  mounted after the session middleware (so `req.session.user` is already
  populated) and before every router (so it fires regardless of which
  route — or none — matches). This is the narrator's baseline: "who's even
  here," before drilling into what they did.
- **Action events** — one line per meaningful state change:
  `auth.register`, `auth.login_success`, `auth.login_failed`,
  `auth.logout`, `order.placed`, `order.rejected`, `admin.product_created`,
  `admin.product_updated`, `admin.product_toggled`,
  `admin.sku_stock_updated`, `admin.sku_added`,
  `admin.order_status_changed`, `admin.admin_created`.

Every line includes an `actor` (`{ kind: 'customer'|'admin'|'anon', id?,
email?, anonId? }` from `actorFromRequest`) and, where relevant, the `ip`
the request came from — enough to tell two simultaneous browsers apart by
account, or by session if neither has signed in yet.

### Placement rule (mirrors ADR 0002)

Action events are logged **after** the triggering `db.transaction(...)`
call has committed, using freshly re-read or already-validated values —
never from inside the transaction, and never built from raw,
not-yet-validated request-body fields. This is the same rule ADR 0002
established for `publish(...)` calls, and for the same reason: a log line
is a claim about what actually happened to the database, so it has to be
made from state the database has already committed to, not from what a
client asked for. Concretely, `order.placed` is logged after `runPurchase()`
returns and after a fresh `SELECT` for the order total; `admin.*` mutation
events are logged immediately after their `UPDATE`/`INSERT`, using the same
values just written; `admin.order_status_changed` logs the `from` status
returned by the transaction itself (captured before the row was updated),
not a value reconstructed from the request.

One exception: `POST /logout` captures the actor into a local variable
*before* calling `req.session.destroy()`, because destruction clears
`req.session.user` before its callback runs — logging from `req` after
destroy would otherwise misreport the actor as anonymous. The event is
still only emitted after the destroy has actually completed.

### What's deliberately excluded

No line ever contains a password, a CSRF token, or a full session id/cookie
value. `auth.login_failed` logs the attempted email (useful for telling two
people apart even when one mistypes a password) but never the password
itself. Anonymous actors only ever get an 8-character prefix of their
session id — enough to distinguish two visitors in a log tail, not enough
to replay or hijack a session from the log output.

### Options considered

- **A logging library / hosted log service** (pino, Winston, Datadog, etc.).
  Rejected for the same reason ADR 0001 avoided extra infrastructure: Fly
  already captures stdout and `flyctl logs` already tails it, so a library
  would add a dependency and configuration surface to solve a problem that
  doesn't exist here. If log volume or structured querying ever became a
  real need, this is the seam to revisit.
- **Logging only on success.** Rejected: a crit narrator needs to be able to
  point at a rejected purchase (oversold SKU, limit exceeded, not-yet-live
  release) as evidence the server-side check actually fired, not just at
  successes — so `order.rejected` is logged with the same prominence as
  `order.placed`.

## Consequences

- Every log line is additive instrumentation on top of code paths that were
  already correct — turning logging off (or losing a line to a restart)
  never changes what the app decides, since no logic branches on whether a
  log call succeeded.
- Because every action event is placed after a commit and uses re-read or
  already-decided values, the log stream can be trusted as a record of what
  the database actually holds, not of what a client claimed — a future
  contributor adding a new mutation should add its log line at the same
  point it would add a `publish(...)` call, per ADR 0002.
- The log stream is the whole crit demo surface: anyone narrating from
  `flyctl logs` should be able to tell two pod members apart from the first
  `http.request` line each produces, well before either registers.
