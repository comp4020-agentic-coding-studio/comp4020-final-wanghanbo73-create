# ADR 0002: Real-time push and concurrent-use behaviour

## Status

Accepted.

## Context

Crit 9 requires the app to be real-time — a change one person makes has to
reach every other open session within about a second, with no reload — and
asks for one explicit, written decision about how the app behaves when
several people use it at once, since the brief leaves that decision open.

Fieldmark's existing architecture is one Node process and one SQLite file
(`docs/adr/0001-stack.md`), with every stock/order mutation already funnelled
through a single synchronous `db.transaction(...)` call per request. Adding
real-time push must not weaken that guarantee: the live layer is only allowed
to announce state that has already been committed, never to let a second
browser tab race ahead of what the server has actually persisted.

## Transport decision

Server-Sent Events (`src/realtime.ts`, `GET /events`), not WebSockets or
polling. The app has no client-to-server real-time need — every write still
goes through the existing CSRF-protected POST routes — so a one-directional
channel is a better fit than a bidirectional one, and `EventSource` gives
reconnect-with-backoff for free. An in-process `Map<channel, Set<Response>>`
is the whole broker: there is exactly one Node process, so there is nothing
to synchronise across.

## The concurrency decision: live push updates read views only

**Decision**: every SSE event patches a read-only element on the page —
a stock figure, a SOLD OUT state, a product's active/inactive visibility, an
order's status badge, the notification-bell count, a new row appearing in
the admin order queue. It never writes into an `<input>`, `<select>`, or
other form control that a user currently has open. An admin's open product
edit form, stock-edit field, or order-status dropdown always shows exactly
what was loaded with the page, until that admin submits it.

Concretely: `src/routes/admin.ts`'s product-edit and order-status handlers
already re-read the current row from the database inside their transaction
before validating and mutating (the same "never trust stale state" pattern
`/buy` uses) — `publish(...)` calls added after each transaction commits only
ever broadcast that freshly-committed, authoritative value. If two admins
have the same order's status dropdown open and both submit, the second
transaction re-reads the row as it now stands: if the first write already
set the target status, the existing `if (order.status === status) return`
guard in `applyStatusChange` makes the second submit a no-op; if the first
write set a different status, the second write simply applies on top
(last-write-wins — no version conflict is raised). Either way, both admins'
screens converge to the true status within about a second of whichever write
actually landed, because the live broadcast — not either admin's own
assumption of what they clicked — is what updates the badge everyone sees.

### Options considered

- **Live-patch open forms too** (e.g. push a stock change into an admin's
  half-filled product-edit form). Rejected: there's no sane way to merge a
  remote update into free-text fields (name, description) an admin is
  mid-edit on without either clobbering their typing or needing operational
  transforms, which is disproportionate for a form two people rarely edit
  at once in practice.
- **Optimistic locking** (a `version` column on `products`/`orders`, reject a
  stale submit with a conflict error). Rejected: the one piece of state that
  actually must never be corrupted under concurrency — stock counts and
  order rows — is already protected by the existing single-transaction
  pattern (`checkout.ts`'s `runPurchase`, `admin.ts`'s `applyStatusChange`).
  A version column would add a user-facing "someone else changed this,
  reload" failure mode for a resource (an order's status, a product's
  price) where last-write-wins is an acceptable, simple outcome — admins are
  a small trusted group, and a wrong status is one more click to fix, not a
  double-sold item.
- **Chosen approach** (above): read views live, forms authoritative-at-submit,
  no new conflict machinery — the transaction pattern already in place is
  the only lock the app needs.

## Reconnect and "the next day"

No event-replay log. An `EventSource` that drops and reconnects (a laptop
sleeping, a flaky network) may miss events published during the gap; rather
than keep an in-memory ring buffer of recent events per channel (more state
to reason about, and still bounded/lossy), the client does one small
`GET /events/resync` fetch on every `open` (which fires on first connect
*and* every auto-reconnect) for just the handful of SKU/order ids visible on
the current page, and patches them — the same read-view patching code path
the live events use. This is simpler than replay and strictly more correct:
replay can only hand back events it happened to buffer, while resync always
returns current truth.

Coming back "the next day" needs nothing special: every page is still
server-rendered on each request, so a fresh page load always reflects
current DB state — the live layer is additive on top of pages that were
already correct, not a replacement for them.

## Presence: explicitly out of scope

Fieldmark does not show "who else is here" on a product or order page. A
storefront customer doesn't need to know another shopper is viewing the same
item, and an admin doesn't need a presence list to act correctly — the
server-side re-validate-on-submit pattern makes correct behaviour
independent of who else happens to be looking. Adding presence here would be
UI surface with no corresponding decision it helps anyone make.

## Consequences

- Every live-patched element is additive sugar on top of a page that is
  already correct without JavaScript — turning off `realtime.js` (or an
  `EventSource`-less browser) degrades to "refresh to see the latest,"
  never to incorrect data, since no decision depends on the client having
  received a push.
- The guarantee this ADR relies on — that broadcasts only ever carry
  post-commit state — means every `publish(...)` call in the codebase must
  stay physically after its `db.transaction(...)` call, not inside it and
  not built from request-body values. Future real-time additions should
  follow the same placement.
- Admins can still momentarily act on a stale read of another admin's
  change (e.g. two people both start filling the status dropdown before
  either submits) — accepted, since the cost of being wrong is one more
  click, not a correctness bug.
