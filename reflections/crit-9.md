# Crit 9 reflection

## What was the breakthrough that moved the work forward?

The breakthrough wasn't the transport choice (SSE vs. WebSockets was an easy
call once I saw the app has no client-to-server real-time need) — it was
deciding where the one required concurrency decision actually had to live.
Early on I was tempted to let the agent "just make it feel live" everywhere,
including patching values straight into open admin forms. Pushing back on
that — insisting live updates only ever touch read-only elements, and an
open edit form stays exactly as loaded until submitted — forced a concrete
ADR instead of a vague feeling of "real-time is good." Writing down *why*
(no sane way to merge a remote stock change into someone's half-typed
product description, and the existing single-transaction purchase/order
code already protects the state that actually matters) made the decision
defensible rather than just convenient. The other concrete catch was mine,
not the agent's: after the first implementation pass, running the full spec
suite showed two view changes had quietly broken existing regex-based
assertions (an attribute inserted between two others the tests expected
adjacent). That's a reminder that "it compiles and looks right" and "it
still satisfies the invariants" are different claims, and only running the
suite tells you which one you actually have.

## What did this work change about who I want to be as a software developer?

It sharpened how I read agent output: not "does this look plausible" but
"does this change survive the existing tests, and can I explain the one
load-bearing design decision in my own words." I want to be the kind of
developer who treats a generated ADR as a draft to interrogate — did it
actually consider the alternative, or just gesture at it — rather than a
checkbox. The stale-data false test failure I also hit (a seeded release
date quietly lapsing with calendar time) was a good lesson in not assuming
every red test is a regression; verifying against a fresh database before
blaming the code is now a habit, not an afterthought.
