# Crit 10 reflection

## What was the breakthrough that moved the work forward?

The breakthrough wasn't writing `logger.ts` itself — that part was
mechanical. It was realizing that "log who did what" only means something
if the logging follows the exact same discipline the app already has for
real-time push: never log from inside a transaction, never log a value the
client supplied, only log state the database has actually committed to. I'd
initially have been tempted to just drop a `console.log` wherever felt
convenient, which would have produced a log stream that looked plausible
but occasionally lied — e.g. logging a requested price instead of the
server-computed one, or logging an order status before a concurrent
transaction had actually decided it. Treating the logging placement rule as
an extension of ADR 0002 rather than a separate problem is what made it
trustworthy enough to narrate a crit from. The other concrete thing was
`POST /logout`: `session.destroy()` clears the session before its callback
runs, so logging naively after destroy would have mislabeled every logout
as "anon" — a bug that wouldn't have shown up until the actual two-browser
demo, since no automated test exercises what a log line says about itself.

## What did this work change about who I want to be as a software developer?

It sharpened the idea that logging is part of the system's correctness
surface, not an afterthought bolted on for a demo. A log line that
misattributes an action is a bug, even though no test asserts on
`console.log` output — the only thing that catches it is actually reading
the log tail while exercising the feature, the same way I'd read a response
body. I want to default to treating "can someone debug this from the logs
alone" as a real requirement on every feature, not just the ones a brief
explicitly asks for it on, since week 10's point — that the logging outlives
the crit — is really a point about who has to live with whatever I ship
after I've moved on to the next feature.
