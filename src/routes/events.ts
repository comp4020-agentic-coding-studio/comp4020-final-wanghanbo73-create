import { Router } from "express";
import { db } from "../db.ts";
import { subscribe } from "../realtime.ts";
import type { OrderRow, SkuRow } from "../types.ts";

export const eventsRouter = Router();

eventsRouter.get("/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");

  const unsubscribers = [subscribe("catalog", res)];
  const user = req.session.user;
  if (user) {
    unsubscribers.push(subscribe(`user:${user.id}`, res));
    if (user.role === "admin") {
      unsubscribers.push(subscribe("admin", res));
    }
  }

  req.on("close", () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  });
});

// Not a general API — just enough for the client script to correct the one
// or two pieces of state visible on the current page after an SSE reconnect
// (a dropped connection can silently miss events published while it was
// down; this is the catch-up path for that gap).
eventsRouter.get("/events/resync", (req, res) => {
  const skusParam = typeof req.query.skus === "string" ? req.query.skus : "";
  const skuIds = skusParam
    .split(",")
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);

  const skus = skuIds.length
    ? (db
        .prepare(`SELECT * FROM skus WHERE id IN (${skuIds.map(() => "?").join(",")})`)
        .all(...skuIds) as SkuRow[]
      ).map((s) => ({ id: s.id, stock: s.stock }))
    : [];

  const orderParam = Number(req.query.order);
  let order: { status: string } | null = null;
  if (Number.isInteger(orderParam) && orderParam > 0 && req.session.user) {
    const row = db.prepare<[number], OrderRow>("SELECT * FROM orders WHERE id = ?").get(orderParam);
    if (row && row.user_id === req.session.user.id) {
      order = { status: row.status };
    }
  }

  res.json({ skus, order });
});
