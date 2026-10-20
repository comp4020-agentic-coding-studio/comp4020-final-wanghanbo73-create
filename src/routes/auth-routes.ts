import { Router } from "express";
import { db } from "../db.ts";
import { hashPassword, verifyPassword } from "../auth.ts";
import { csrfToken } from "../csrf.ts";
import { layout } from "../views/layout.ts";
import { loginPage } from "../views/login.ts";
import { registerPage } from "../views/register.ts";
import { logEvent } from "../logger.ts";
import type { Role, SessionUser, UserRow } from "../types.ts";

export const authRouter = Router();

function safeNext(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) {
    return "/";
  }
  return next;
}

authRouter.get("/register", (req, res) => {
  const next = safeNext(req.query.next);
  res.send(
    layout({
      title: "Register",
      user: req.session.user,
      csrfToken: csrfToken(req),
      body: registerPage({ csrfToken: csrfToken(req), next }),
    }),
  );
});

authRouter.post("/register", (req, res) => {
  const next = safeNext(req.query.next ?? req.body.next);
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";

  const render = (error: string, status: number): void => {
    res.status(status).send(
      layout({
        title: "Register",
        user: req.session.user,
        csrfToken: csrfToken(req),
        body: registerPage({ csrfToken: csrfToken(req), next, error }),
      }),
    );
  };

  if (!email || !password || password.length < 8) {
    render("Email and a password of at least 8 characters are required.", 400);
    return;
  }

  const existing = db.prepare<[string], UserRow>("SELECT * FROM users WHERE email = ?").get(email);
  if (existing) {
    render("An account with that email already exists.", 409);
    return;
  }

  // Role is always 'customer' here, regardless of anything posted in the
  // body — there is no HTTP path that creates an admin account.
  const role: Role = "customer";
  const passwordHash = hashPassword(password);
  const info = db
    .prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)")
    .run(email, passwordHash, role);

  req.session.regenerate((err) => {
    if (err) {
      render("Something went wrong — please try again.", 500);
      return;
    }
    req.session.user = { id: Number(info.lastInsertRowid), email, role };
    req.session.save(() => {
      // Logged after the session carries the new identity, so the actor in
      // this line is the account that was just created, not "anon".
      logEvent("auth.register", req, { userId: req.session.user!.id, email });
      res.redirect(next);
    });
  });
});

authRouter.get("/login", (req, res) => {
  const next = safeNext(req.query.next);
  res.send(
    layout({
      title: "Log in",
      user: req.session.user,
      csrfToken: csrfToken(req),
      body: loginPage({ csrfToken: csrfToken(req), next }),
    }),
  );
});

authRouter.post("/login", (req, res) => {
  const next = safeNext(req.query.next ?? req.body.next);
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";

  const fail = (): void => {
    res.status(401).send(
      layout({
        title: "Log in",
        user: req.session.user,
        csrfToken: csrfToken(req),
        body: loginPage({ csrfToken: csrfToken(req), next, error: "Invalid email or password." }),
      }),
    );
  };

  const user = db.prepare<[string], UserRow>("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    // Never log the attempted password — only that this email failed to
    // authenticate, which is what tells two people apart in the log stream
    // without exposing credentials.
    logEvent("auth.login_failed", req, { email });
    fail();
    return;
  }

  const sessionUser: SessionUser = { id: user.id, email: user.email, role: user.role };
  req.session.regenerate((err) => {
    if (err) {
      fail();
      return;
    }
    req.session.user = sessionUser;
    req.session.save(() => {
      logEvent("auth.login_success", req, { userId: user.id, email: user.email, role: user.role });
      res.redirect(next);
    });
  });
});

authRouter.post("/logout", (req, res) => {
  // Capture before destroy() clears req.session.user — logEvent(..., req)
  // after destruction would otherwise log this as "anon".
  const actorBeforeDestroy = req.session.user;
  const ip = req.ip;
  req.session.destroy(() => {
    if (actorBeforeDestroy) {
      logEvent("auth.logout", null, { userId: actorBeforeDestroy.id, email: actorBeforeDestroy.email, ip });
    }
    res.redirect("/");
  });
});
