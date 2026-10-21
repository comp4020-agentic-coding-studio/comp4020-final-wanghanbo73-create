# Research note: verifiable constraints beat trusting the plan

The agentic-coding literature increasingly draws a line between two ways of
keeping an AI coding agent correct: aligning the model so it *wants* to
behave (a neural guardrail baked into training or a prompt) versus giving it
an external, checkable constraint it cannot talk its way around (a symbolic
guardrail). Hong et al.'s review of agent security and safety benchmarks
found that most of the field still leans on the former — 85% of the
benchmarks they surveyed state no verifiable requirement at all, or only a
high-level goal, even though they estimate 74% of real agent requirements
*could* be expressed symbolically and enforced mechanically instead
("Don't Make Models Guess Security and Safety: Symbolic Guardrails for
Domain-Specific AI Agents," arXiv:2604.15579). My position, built on this
project rather than against it in the abstract, is that this gap is the
single highest-leverage thing to close when working with an agent day to
day: a rule the agent merely agrees with is not the same thing as a rule a
test enforces, and treating them as equivalent is where agentic coding
quietly goes wrong.

Fieldmark's own process is the evidence for that claim. `CLAUDE.md` states
the invariants — no trusting client-supplied price or role, every stock
mutation inside one `db.transaction`, idempotency keys honoured, ownership
checks absolute — but the words in that file are a neural-style guardrail:
Claude reads them and tries to comply, the same way an aligned model tries
to comply with a safety policy. What actually catches a violation is
`spec/*.test.ts` running HTTP requests against the live app and asserting on
responses a client can't talk its way past — a 404 for someone else's
order whether or not the agent "understood" the rule correctly that session.
Three bugs this project hit were each found exactly this way, not by
re-reading the plan: an unprefixed Express 5 router silently applying
`requireAdmin` to `/readme/`, a `DATA_DIR` mismatch that would have quietly
dropped every order on redeploy, and an `http.request` logger reporting the
wrong path once a request passed through a prefixed sub-router. None of
these were things the agent disagreed it should avoid — they were things no
symbolic check happened to be watching for until I added one (a spec test,
or in the logging case, a live log tail compared against a known request).
Huang et al.'s field study of professional developers reaches the same
conclusion from the practitioner side: developers who get good outcomes from
coding agents are the ones who "don't vibe, they control" — they keep
agent output inside an externally checkable loop (tests, diffs, structured
review) rather than trusting a plausible-sounding explanation of what the
code does ("Professional Software Developers Don't Vibe, They Control: AI
Agent Use for Coding in 2025," arXiv:2512.14012).

The practical upshot for how I used Claude on this project was to treat
every crit the same way: write the plan, but then ask what the verifiable
artifact for that plan is — a spec test, a log line with a schema, a commit
whose SHA I can check resolves — before calling the increment done, rather
than accepting that the implementation "looks right" against the plan I
approved. The ADRs in this repo are themselves part of that discipline: they
record *why* a decision is safe (e.g. why last-write-wins is acceptable for
admin status changes, why SSE rather than WebSockets) in a form a future
reader — human or agent — can check the actual code against, not just a
narrative to be taken on faith. The corollary, and the thing I'd actively
push back on if advising someone less careful here: an agent that writes a
confident, well-structured PROCESS.md entry about what it did is not
evidence that the thing is correct. The confidence of the explanation and
the correctness of the code are produced by the same system and are not
independent signals — which is exactly the failure mode symbolic guardrails
exist to route around.

## Sources

- Hong, She, Kang, Timperley & Kästner, ["Don't Make Models Guess Security
  and Safety: Symbolic Guardrails for Domain-Specific AI
  Agents"](https://arxiv.org/html/2604.15579v2), arXiv:2604.15579.
- Huang, Reyna, Lerner, Xia & Hempel, ["Professional Software Developers
  Don't Vibe, They Control: AI Agent Use for Coding in
  2025"](https://arxiv.org/html/2512.14012v2), arXiv:2512.14012.
