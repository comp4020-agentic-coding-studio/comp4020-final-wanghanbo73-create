# Crit 10 reflection

## What was the breakthrough that moved the work forward?

The breakthrough wasn't writing `logger.ts` itself — that part was
mechanical. It was realizing that "log who did what" only means something
if the logging follows the exact same discipline the app already has for
real-time push: never log from inside a transaction, never log a value the
client supplied, only log state the database has actually committed to.
Treating the logging placement rule as an extension of ADR 0002 rather than
a separate problem is what caught the `POST /logout` case before it shipped
— `session.destroy()` clears the session before its callback runs, so
logging naively after destroy would have mislabeled every logout as "anon."

But the rule that caught that one still let a real bug through, and that's
the part that actually taught me something: `req.path`, read inside a
`res.on('finish')` callback, isn't a fixed value you can safely read late.
Express mounts `/admin` as a prefixed sub-router, which rewrites `req.url`
for the duration of its own routing, and `req.path` is a live getter off
that — so by the time a request to `/admin/products` had finished, the log
line said `"path":"/products"` or `"/"` instead of what was actually
requested. Every automated test passed the whole time, because nothing
asserts on what a log line *says about itself* — the tests only check that
the right HTTP status came back, which it did. I only found it because I
went and actually read the live log tail while deliberately sending a
blocked request, the exact thing a crit narrator would do, instead of
trusting that green tests meant the logging was correct too. The fix —
capture `req.originalUrl` eagerly, before `next()` runs, instead of reading
a value that changes meaning over the request's lifetime — is a one-line
diff, but finding it required treating "does the log line describe reality"
as a thing that needs its own verification pass, separate from "does the
request behave correctly."

## What did this work change about who I want to be as a software developer?

It sharpened the idea that logging is part of the system's correctness
surface, not an afterthought bolted on for a demo. A log line that
misattributes a path or an actor is a bug in exactly the same sense a wrong
HTTP status would be, even though no test asserts on `console.log` output —
the only thing that catches it is actually reading the log tail while
exercising the feature live, the way I'd read a response body, rather than
trusting that "tests pass" covers it. I want to default to treating "can
someone debug this from the logs alone" as a real requirement I verify by
doing it, not one I assume is satisfied because the underlying request
behaves correctly, since week 10's point — that the logging outlives the
crit — is really a point about who has to live with whatever I ship after
I've moved on to the next feature.
