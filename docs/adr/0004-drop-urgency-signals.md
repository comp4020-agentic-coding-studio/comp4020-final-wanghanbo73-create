# ADR 0004: Drop-live push and anonymous watcher counts

## Status

Accepted. Narrows, but does not reverse, the presence decision in
[ADR 0002](0002-realtime-concurrency.md).

## Context

Feedback on the project so far was that it reads as a generic storefront
demo rather than an argument for *why a real clothing brand would commission
this specific architecture*. The useful framing: imagine pitching the
brand's owner on building this, on this infrastructure, and having to show
them — live, on the Fly.dev deployment, not in a slide — that it's worth it.

The business case this app is actually built for is a **limited drop**: a
numbered run of a product that goes on sale at a fixed time, in small
quantities, to an audience that knows the exact moment it unlocks. Two
things matter commercially in that scenario that a regular always-in-stock
product doesn't raise:

1. **Overselling during a rush damages trust in a way a slow-moving SKU
   never will.** Telling a customer "sorry, that's actually sold out" after
   they've already paid is the one failure a drop cannot afford — it is the
   entire reason the brand would pay for real-time, correctly-synchronised
   stock rather than a static catalogue page.
2. **A drop needs to feel like a drop.** If a hundred people are refreshing
   a page at the release minute and nothing on screen tells them that, the
   architecture's correctness is invisible — there's no way for the brand
   owner (or a tutor standing in for one) to see that real demand is being
   handled safely, only to take it on faith.

This ADR covers two small, additive features built to make both of those
things demonstrable: stock no longer silently resolves itself only on
reload once a drop goes live, and an anonymous "N people viewing this drop"
count gives the room something to watch move during a live purchase rush.
Neither touches `/buy`'s transaction, `/admin`'s mutation handlers, or any
other code CLAUDE.md's "good" list already covers — see Consequences.

## Decision 1: drop-goes-live push

**Decision**: a background interval (`src/drop-watcher.ts`, every 5s)
re-reads `products` for any limited release whose `release_at` has just
passed and that hasn't already been announced this process lifetime, and
`publish("catalog", "product_live", { productId })`s it. `public/realtime.js`
listens for `product_live` and flips a pending drop's badge, notice, and
disabled purchase form to live — the same read-view patching pattern every
other event in that file already uses.

Before this, `isLive` was computed fresh on every page load
(`src/routes/catalog.ts`) but nothing pushed a change to a tab already open
before the release moment — the single most dramatic second of a drop
("it just went live") was invisible without a manual refresh. That's the
gap this closes.

### Options considered

- **Client-side countdown that flips the UI locally at `release_at`.**
  Rejected: the client's clock is not authoritative, and trusting it here
  would let a tab with a fast or wrong clock enable the buy button before
  the server will actually accept an order — `/buy` already re-checks
  `release_at` server-side (`src/routes/checkout.ts`), so a client-only
  countdown would just be a UI lie the server then has to reject.
- **Have every stock-affecting write re-check all drops' release times.**
  Rejected: a drop going live isn't triggered by any user action — nothing
  writes to the `products` table at the moment a drop should unlock — so
  there is no mutation to hang the check on. A timer checking committed
  state is the only option that doesn't invent a write where none belongs.
- **Chosen approach** (above): a cheap poll against already-committed rows,
  publishing only a state transition, never raw request data — consistent
  with every other `publish(...)` call in the app.

## Decision 2: anonymous, aggregate watcher counts — narrowing ADR 0002

ADR 0002 ruled presence out of scope entirely: *"A storefront customer
doesn't need to know another shopper is viewing the same item... Adding
presence here would be UI surface with no corresponding decision it helps
anyone make."* That argument still holds for *identity-bearing* presence —
knowing *who* else is looking doesn't change what the server does. It does
not hold for an *aggregate, anonymous* count on a limited drop specifically:
during a rush, "47 people are watching this drop" is a demand signal the
business cares about independent of any individual shopper's identity, and
it is exactly the kind of evidence a brand owner would want to see working
live before approving the idea.

**Decision**: `src/realtime.ts` tracks a plain `Map<productId, count>`
(`joinWatchers`/`watcherCount`), incremented when an `/events` SSE
connection declares `?watching=<productId>` (set by `public/realtime.js`
from a `data-watching-product-id` attribute `layout()` renders only on a
limited product's own detail page) and decremented on disconnect. No user
id, session id, or any other identity is ever attached to the count — only
a number, published on the existing `"catalog"` channel as a `watchers`
event. `src/views/product.ts` and `src/views/limited.ts` render a
`data-watchers` element for limited products that this count patches.

This is still bound by ADR 0002's actual reasoning: it is additive sugar
that doesn't change what the server decides for anyone's purchase, and it
is not a per-user presence list — no page anywhere lists *who* is watching,
only how many.

### Options considered

- **Per-user presence list** ("Alex, Jordan, and 3 others are viewing
  this"). Rejected for the same reason ADR 0002 rejected it originally: it
  would require tracking and exposing other shoppers' identities for a
  correctness decision that doesn't need them, and raises a privacy
  question ("who sees that I'm here") a plain count never does.
- **Poll-based count** (client polls an endpoint every few seconds instead
  of pushing over the open SSE connection). Rejected: the app already holds
  one SSE connection per visitor for stock/order updates; counting
  join/leave on that same connection is free, while polling would add a
  second request pattern and a visible lag the push-based count doesn't
  have.
- **Chosen approach** (above): join/leave tracked on the connection the app
  already keeps open, published through the existing hub, never exposing
  anything beyond a number.

## Consequences

- Both features are pure additions to the `publish`/`subscribe` hub; no
  `db.transaction(...)` call in `checkout.ts` or `admin.ts` changed, so
  every invariant CLAUDE.md lists under "What 'good' means for this app"
  (no-oversell, idempotency, ownership checks, server-side limits) is
  unaffected and unaudited-by-this-change.
- Like every other live-patched element (ADR 0002's consequence section),
  both degrade gracefully: without JavaScript or `EventSource` support, a
  drop still goes live correctly on the next page load, and the absence of
  a watcher count changes nothing about what anyone can buy.
- The watcher count is explicitly a vanity/business signal, not a
  correctness one — it is never read by any server-side decision (not
  `/buy`, not `/checkout`, nothing in `src/routes/admin.ts`), and losing it
  entirely (a restart resets every count to zero) is cosmetic, not a bug.
