import { randomBytes } from "node:crypto";
import express from "express";
import session from "express-session";
import { db } from "./db.ts";
import { SqliteSessionStore } from "./session-store.ts";
import { csrfProtection } from "./csrf.ts";
import { catalogRouter } from "./routes/catalog.ts";
import { authRouter } from "./routes/auth-routes.ts";
import { checkoutRouter } from "./routes/checkout.ts";
import { ordersRouter } from "./routes/orders.ts";
import { notificationsRouter } from "./routes/notifications.ts";
import { adminRouter } from "./routes/admin.ts";
import { readmeRouter } from "./routes/readme.ts";
import { layout } from "./views/layout.ts";

const app = express();

// Fly terminates TLS in front of this app; trust its proxy so `req.secure`
// (used below for the session cookie) reflects the real scheme.
app.set("trust proxy", 1);

app.use(express.static("public"));
app.use(express.urlencoded({ extended: false }));

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

app.use(csrfProtection);

app.use(catalogRouter);
app.use(authRouter);
app.use(checkoutRouter);
app.use(ordersRouter);
app.use(notificationsRouter);
app.use("/admin", adminRouter);
app.use(readmeRouter);

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
