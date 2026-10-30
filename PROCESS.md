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

## Reframing around a business case (post-Crit-10 tutor feedback)

Tutor feedback after Crit 10 was specific and recurring across two
submissions: the process score was consistently the lowest of the three
marking criteria, with the comment that *how* the agent was directed
mattered more to the mark than what got built, that there was "no
explanation of the use of oral exams for debugging and not much conceptual
grounding for how to debug effectively," and — on the artefact itself — that
an "abstract relationship" central to the real-time claim was "just taken as
a given" rather than explained. The suggested exercise for this round:
imagine pitching the brand's owner on building this, and prove on the
deployed app that real-time concurrent-purchase handling is both achievable
and commercially important, not just a crit requirement being satisfied.
The three paragraphs below are a direct response to those three points, in
order.

### The actual back-and-forth, not just the outcome

The work here didn't start from a code change — it started from pasting the
tutor's comment to Claude verbatim and asking "what do you think I should
change," then "can both directions [story and code] be pursued together,"
before any plan was written. Claude's first-pass read of the codebase found
the real-time/purchase machinery was already sound (the single-transaction
pattern from Crit 9, still unchanged) and that the actual gap was narrative:
every existing ADR justified real-time push as "the crit brief asked for
it," never as something a paying brand would want. That framing was
accepted, but the plan it produced was checked against the codebase before
approval, not rubber-stamped — two concrete gaps were only found because the
plan was read against `src/views/limited.ts` and `docs/adr/0002` directly
rather than taken on trust: `/limited`'s grid markup was missing the
`data-product-id`/`data-sku-id` attributes that the *existing* live-patch
JavaScript already looks for, meaning stock updates silently never worked on
that page at all (a pre-existing bug the narrative reframing happened to
surface), and ADR 0002 explicitly rejected presence as "UI surface with no
corresponding decision it helps anyone make" — directly in tension with a
"show the room is excited about this drop" feature. Rather than let the
agent quietly reverse that earlier decision, the direction given was:
narrow it, don't reverse it — argue specifically why an anonymous aggregate
count is a different claim than the identity-bearing presence list ADR 0002
was actually arguing against, and write that distinction down as its own
ADR rather than editing over the old one. That's the instruction that
produced [ADR 0004](docs/adr/0004-drop-urgency-signals.md)'s "Decision 2"
section arguing the narrowing explicitly rather than asserting it.

### Debugging method: treating the agent's explanation as the test, not the code

The four runtime bugs in the section above were none of them found by
reading a diff and spotting the error. Each was found by making the agent
state, out loud, what it expected to happen, and then checking that
statement against what the running app actually did — an oral-exam
pattern, not a code-review one. The concrete example from this round:
`scripts/simulate-drop-rush.ts`'s first run failed with "could not find
admin edit link for drop-hitops." The fix was not to read the regex and
guess; it was to ask the agent to explain, before touching the code, *why*
it expected `/admin/products` to contain the string `"drop-hitops"` at all.
Stating that assumption out loud exposed it immediately: the agent's own
mental model was "the admin table must show something identifying the
product," but it had conflated two different identifiers — the URL slug
(`drop-hitops`, used for public SKU routes) and the display name ("Drop
Hi-Tops (Limited)", the only string the admin table actually renders). The
bug wasn't in the regex, it was in an unstated assumption that those two
strings were interchangeable; the regex was just where that assumption
happened to surface as a crash. This is the general pattern worth naming:
reading code checks whether the implementation matches the author's model
of the system, but says nothing about whether that model is correct in the
first place. Asking the agent to justify an assumption *before* it's
allowed to patch the symptom forces the model itself into the open, where a
wrong premise is obvious in one sentence instead of buried in a regex. The
same pattern caught the Crit-10 logging bug recorded below (`req.path`
inside a sub-router) — the fix only made sense after asking the agent to
explain, in words, what value `req.path` holds inside an Express 5
path-prefixed sub-router, which is where "but Express rewrites it" came out
as a stated, checkable claim rather than a silent assumption.

### Making the mechanism explicit, not assumed

The first-round feedback on the artefact was that a relationship central to
the real-time claim — how concurrent demand actually produces the
contention the UI is supposed to be proving something about — was asserted
rather than explained. The mechanism, stated plainly rather than left
implicit: a limited drop's whole commercial risk is that demand arrives
*correlated in time* — a hundred requests landing in the same second a drop
unlocks, not spread evenly across a day — which is a queueing problem, not
just a correctness problem. `better-sqlite3`'s single synchronous
connection means Fieldmark's write path has exactly one server (in the
queueing-theory sense): every `/buy` request that reaches `runPurchase`'s
`db.transaction(...)` call is serviced one at a time, so when arrivals spike
faster than that one server can complete transactions, the excess doesn't
get dropped or corrupted — it queues, waiting its turn, and each request
still sees the real, post-queue state of stock when its turn comes, which
is *why* two buyers racing for the last unit never produces two winners.
Utilisation of that single write path rises toward 1 during a rush (it is
doing nothing but processing `/buy`/`/admin` transactions back to back);
queue length — the count of requests waiting their turn — is what grows
once arrivals briefly exceed that one server's completion rate, which is
exactly the scenario `scripts/simulate-drop-rush.ts` and
`spec/limited-drop-rush.test.ts` manufacture on purpose (many buyers firing
at once, deliberately restocked low) rather than leaving to chance. The
watcher count and drop-live push (below) are not decorative additions on
top of that: they are what make the *size of the queue the architecture is
built to survive* visible on screen while it happens, instead of asking
whoever's watching to take the serialisation claim on faith.

That reframing didn't change any existing correctness guarantee — it added
two small, additive features to make the limited-drop business case
demonstrable, and rewrote the README and this document's framing around it:

- **Drop-goes-live push** (`src/drop-watcher.ts`): a background interval
  announces the moment a limited release's `release_at` passes, so a tab
  left open before a drop unlocks flips to a live buy button without a
  reload — previously `isLive` only recomputed on the next page load.
- **Anonymous, aggregate watcher counts per drop** (`src/realtime.ts`'s
  `joinWatchers`/`watcherCount`, wired through `GET /events?watching=`):
  narrows, rather than reverses,
  [`docs/adr/0002-realtime-concurrency.md`](docs/adr/0002-realtime-concurrency.md)'s
  decision to leave presence out of scope — a per-user presence list is
  still rejected for the reasons that ADR gives, but a plain count is a
  legitimate demand signal for a drop specifically, distinct from the
  per-user case. Full reasoning for both decisions is in
  [`docs/adr/0004-drop-urgency-signals.md`](docs/adr/0004-drop-urgency-signals.md).

Alongside the push features, `scripts/simulate-drop-rush.ts` and
`spec/limited-drop-rush.test.ts` give the no-oversell and per-account-limit
guarantees a concurrency-specific demo and test scoped to a live drop, in
addition to the generic last-unit race already covered by
`spec/inventory.test.ts`.

## What's still mine to do by hand

The Crit 9 multi-tab verification (buy-down-to-sold-out reflected live in a
second tab; admin status change reflected on an open customer order page)
and the real two-Chrome-profile run for Crit 10 — narrated live rather than
via the cookie-jar substitute above — still need to happen in person before
submission.
