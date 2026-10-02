import { Router } from "express";
import { db } from "../db.ts";
import { requireCustomer } from "../auth.ts";
import { csrfToken } from "../csrf.ts";
import { layout } from "../views/layout.ts";
import { ordersPage } from "../views/orders.ts";
import { orderDetailPage } from "../views/order-detail.ts";
import type { OrderItemRow, OrderRow } from "../types.ts";

export const ordersRouter = Router();

ordersRouter.get("/orders", requireCustomer, (req, res) => {
  const user = req.session.user!;
  const orders = db
    .prepare<[number], OrderRow>("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC")
    .all(user.id);
  res.send(
    layout({
      title: "My Orders",
      user: req.session.user,
      csrfToken: csrfToken(req),
      body: ordersPage(orders),
    }),
  );
});

ordersRouter.get("/orders/:id", requireCustomer, (req, res) => {
  const user = req.session.user!;
  const orderId = Number(req.params.id);
  const order = db.prepare<[number], OrderRow>("SELECT * FROM orders WHERE id = ?").get(orderId);

  if (!order || order.user_id !== user.id) {
    res.status(404).send(
      layout({
        title: "Not found",
        user: req.session.user,
        csrfToken: csrfToken(req),
        body: "<h1>Order not found</h1>",
      }),
    );
    return;
  }

  const items = db
    .prepare<[number], OrderItemRow>("SELECT * FROM order_items WHERE order_id = ?")
    .all(order.id);

  res.send(
    layout({
      title: `Order #${order.id}`,
      user: req.session.user,
      csrfToken: csrfToken(req),
      body: orderDetailPage(order, items),
    }),
  );
});
