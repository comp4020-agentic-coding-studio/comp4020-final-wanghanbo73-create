import { Router } from "express";
import { db } from "../db.ts";
import { requireCustomer } from "../auth.ts";
import { csrfToken } from "../csrf.ts";
import { layout } from "../views/layout.ts";
import { notificationsPage } from "../views/notifications.ts";
import { listNotifications } from "../notifications.ts";

export const notificationsRouter = Router();

notificationsRouter.get("/notifications", requireCustomer, (req, res) => {
  const user = req.session.user!;
  res.send(
    layout({
      title: "Notifications",
      user: req.session.user,
      csrfToken: csrfToken(req),
      body: notificationsPage(listNotifications(user.id), csrfToken(req)),
    }),
  );
});

notificationsRouter.post("/notifications/:id/read", requireCustomer, (req, res) => {
  const user = req.session.user!;
  const eventId = Number(req.params.id);

  // Ownership check: only mark as read if this event belongs to one of the
  // current user's own orders — same principle as /orders/:id.
  const event = db
    .prepare<[number], { order_id: number; user_id: number }>(
      `SELECT oe.order_id, o.user_id
       FROM order_events oe JOIN orders o ON o.id = oe.order_id
       WHERE oe.id = ?`,
    )
    .get(eventId);

  if (event && event.user_id === user.id) {
    db.prepare(
      "INSERT OR IGNORE INTO notification_reads (user_id, event_id) VALUES (?, ?)",
    ).run(user.id, eventId);
  }

  res.redirect("/notifications");
});
