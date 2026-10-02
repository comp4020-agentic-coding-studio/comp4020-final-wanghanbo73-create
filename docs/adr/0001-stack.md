# ADR 0001: Stack choices for Fieldmark

## Status

Accepted.

## Context

The brief fixes the deploy shape (one Fly machine, 256 MB memory, one
persistent volume at `/data`, no separate database server) and the harness
(`spec/invariants.test.ts`, `fly.toml`, the CI workflow) but leaves the stack
inside the Dockerfile entirely open. The app needs: real server-side access
control, a purchase flow that can't be raced into overselling or double-
charging, session persistence across restarts/redeploys, and a small enough
footprint to fit the memory budget and start quickly on Fly's
scale-to-zero machines.

## Decisions

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node 24, `node src/server.ts` directly | Node 24 strips TypeScript types natively; no build step, no bundler, no source maps to keep in sync. Fewer moving parts to misconfigure inside a 256 MB container. |
| HTTP framework | Express 5 | Small, well-understood, synchronous-friendly routing. Express 5's promise-aware error handling removes the need for a wrapper around every async route. |
| Database | SQLite via `better-sqlite3` | The deploy has exactly one volume and no separate DB service — SQLite *is* the persistence layer, not a compromise. `better-sqlite3`'s synchronous API means the "check stock, decrement, insert order" critical section is a single `db.transaction(...)` call with no `await` inside it: the native binding serializes it against every other request on the same connection, which is the entire no-oversell guarantee. An async driver would have needed an explicit application-level lock to get the same property. |
| Sessions | `express-session` + a custom SQLite-backed `Store` | Sessions need to survive a process restart (Fly stops idle machines) without adding a second storage system. A ~60-line `Store` subclass against a `sessions` table is less surface area than pulling in a session-store package and auditing its SQLite support. |
| CSRF | `csrf-sync` | Synchronizer-token pattern over double-submit cookies, with a custom `getTokenFromRequest` reading the hidden `_csrf` form field — matches a plain server-rendered form app better than a header-based default aimed at SPAs. |
| Passwords | Node's built-in `crypto.scrypt` | No extra dependency for something the standard library already does well; per-user random salt stored as `salt:hash` hex, compared with `timingSafeEqual`. |
| Views | Hand-written template-literal functions | No client framework is needed for server-rendered forms and tables, and a template-literal view is trivial to keep type-checked against the row types it renders, with no separate templating language or compile step. |
| README rendering | `marked` | `/readme/` needs to render `README.md` as HTML for `spec/invariants.test.ts`'s heading check; `marked` is a small, dependency-light markdown-to-HTML converter with no other opinions. |
| Base image | `node:24-slim` (glibc), not `alpine` | `better-sqlite3` ships a prebuilt native binary for glibc; Alpine's musl libc would force a from-source compile, pulling a full C++ toolchain into the image just to produce a binary `slim` gets for free. |

## Consequences

- Everything in the app runs on one Node process and one SQLite file — true
  of the running app in dev, in CI, and on Fly, so "it works locally" and
  "it works deployed" are the same claim, not two separate ones to verify.
- The correctness of the purchase flow rests on a single invariant (every
  stock/order mutation happens inside one `db.transaction` call) rather than
  on getting distributed locking right — easier to audit, but it does mean
  the app cannot scale past one machine without re-deciding this ADR.
- No bundler/build step means Docker image layers are just `node_modules`
  plus source, which keeps the image small and the build fast, at the cost
  of shipping TypeScript source (not compiled JS) into production — acceptable
  given Node 24 strips types at negligible overhead for an app this size.
