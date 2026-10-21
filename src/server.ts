import { randomBytes } from "node:crypto";
import express from "express";
import session from "express-session";
import { db } from "./db.ts";
import { SqliteSessionStore } from "./session-store.ts";
import { csrfProtection } from "./csrf.ts";
import { logEvent } from "./logger.ts";
import { catalogRouter } from "./routes/catalog.ts";
import { authRouter } from "./routes/auth-routes.ts";
import { checkoutRouter } from "./routes/checkout.ts";
import { ordersRouter } from "./routes/orders.ts";
import { notificationsRouter } from "./routes/notifications.ts";
import { aiChatRouter } from "./routes/ai-chat.ts";
import { adminRouter } from "./routes/admin.ts";
import { readmeRouter } from "./routes/readme.ts";
import { eventsRouter } from "./routes/events.ts";
import { layout } from "./views/layout.ts";

const app = express();

// Fly terminates TLS in front of this app; trust its proxy so `req.secure`
// (used below for the session cookie) reflects the real scheme.
app.set("trust proxy", 1);

app.use(express.static("public"));
app.use(express.urlencoded({ extended: false }));
// Only the AI chat endpoint sends JSON bodies (everything else is form posts) —
// scoped to its path so the rest of the app's body handling is untouched.
app.use("/ai-chat/stream", express.json({ limit: "32kb" }));

const sessionSecret = process.env.SESSION_SECRET ?? randomBytes(32).toString("hex");
if (!process.env.SESSION_SECRET) {
  console.warn(
    "[server] SESSION_SECRET not set — using a random secret for this process; sessions won't survive a restart with a different secret",
  );
}

app.use(
  session({
    store: new SqliteSessionStore(db),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    name: "sid",
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      // "auto" asks express-session to look at req.secure, which (with
      // trust proxy set above) reflects x-forwarded-proto from Fly's edge.
      secure: "auto",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  }),
);

// Baseline per-request access log: every request, who made it, what they
// got back. Mounted after the session middleware so req.session.user is
// already populated, and before every router so it sees every request
// regardless of which one (or none) matches. Action-level logs below (in
// the route handlers) are the "what did they actually do" detail on top of
// this; this is the "who's even here" baseline a crit narrator starts from.
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  // Capture the path now, not inside the `finish` handler: a sub-router
  // mounted with a prefix (e.g. "/admin") temporarily rewrites `req.url`
  // for the duration of its own routing, and `req.path` is a live getter
  // off that — reading it after the response has finished could see the
  // stripped, prefix-less path instead of what was actually requested.
  // `req.originalUrl` is set once up front and never rewritten by nested
  // routers, so it's safe to read at any time, but capturing eagerly here
  // avoids relying on that guarantee holding for every future router.
  const path = req.originalUrl;
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    logEvent("http.request", req, {
      method: req.method,
      path,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
    });
  });
  next();
});

app.use(csrfProtection);

app.use(catalogRouter);
app.use(authRouter);
app.use(checkoutRouter);
app.use(ordersRouter);
app.use(notificationsRouter);
app.use(aiChatRouter);
app.use("/admin", adminRouter);
app.use(readmeRouter);
app.use(eventsRouter);

app.use((req, res) => {
  res.status(404).send(
    layout({
      title: "Not found",
      user: req.session.user,
      body: "<h1>Page not found</h1>",
    }),
  );
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, "0.0.0.0", () => {
  console.log(`[server] listening on 0.0.0.0:${port}`);
});
