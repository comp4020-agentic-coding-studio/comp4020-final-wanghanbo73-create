import { randomUUID } from "node:crypto";
import { Router } from "express";
import { db } from "../db.ts";
import { requireCustomer } from "../auth.ts";
import { csrfToken } from "../csrf.ts";
import { layout } from "../views/layout.ts";
import { checkoutPage } from "../views/checkout.ts";
import { escapeHtml } from "../views/html.ts";
import { recordOrderEvent } from "../notifications.ts";
import type { OrderRow, ProductRow, SkuRow } from "../types.ts";

export const checkoutRouter = Router();

class PurchaseError extends Error {}

checkoutRouter.get("/checkout", requireCustomer, (req, res) => {
  const skuId = Number(req.query.sku);
  const qty = Number(req.query.qty) || 1;

  if (!Number.isInteger(skuId) || skuId <= 0 || !Number.isInteger(qty) || qty <= 0) {
    res.status(400).send(
      layout({
        title: "Checkout",
        user: req.session.user,
        csrfToken: csrfToken(req),
        body: `<h1>Checkout</h1><p class="notice notice--error">Invalid selection.</p>`,
      }),
    );
    return;
  }

  const sku = db.prepare<[number], SkuRow>("SELECT * FROM skus WHERE id = ?").get(skuId);
  const product = sku
    ? db.prepare<[number], ProductRow>("SELECT * FROM products WHERE id = ?").get(sku.product_id)
    : undefined;

  if (!sku || !product || !product.active) {
    res.status(404).send(
      layout({
        title: "Checkout",
        user: req.session.user,
        csrfToken: csrfToken(req),
        body: `<h1>Checkout</h1><p class="notice notice--error">That item is no longer available.</p>`,
      }),
    );
    return;
  }

  res.send(
    layout({
      title: "Checkout",
      user: req.session.user,
      csrfToken: csrfToken(req),
      body: checkoutPage({
        product,
        sku,
        qty,
        csrfToken: csrfToken(req),
        idempotencyKey: randomUUID(),
      }),
    }),
  );
});

checkoutRouter.post("/buy", requireCustomer, (req, res) => {
  const user = req.session.user!;
  const skuId = Number(req.body.sku_id);
  const qty = Number(req.body.qty);
  const idempotencyKey = typeof req.body.idempotency_key === "string" ? req.body.idempotency_key : "";

  if (!Number.isInteger(skuId) || skuId <= 0 || !Number.isInteger(qty) || qty <= 0 || !idempotencyKey) {
    res.status(400).send(
      layout({
        title: "Checkout",
        user: req.session.user,
        csrfToken: csrfToken(req),
        body: `<h1>Order failed</h1><p class="notice notice--error">Invalid order submission.</p>`,
      }),
    );
    return;
  }

  const runPurchase = db.transaction((): OrderRow => {
    // Idempotency: if this key was already used, return the existing order
    // instead of erroring or creating a duplicate.
    const existingOrder = db
      .prepare<[string], OrderRow>("SELECT * FROM orders WHERE idempotency_key = ?")
      .get(idempotencyKey);
    if (existingOrder) {
      if (existingOrder.user_id !== user.id) {
        throw new PurchaseError("This order does not belong to you.");
      }
      return existingOrder;
    }

    const sku = db.prepare<[number], SkuRow>("SELECT * FROM skus WHERE id = ?").get(skuId);
    if (!sku) throw new PurchaseError("That item no longer exists.");
    const product = db
      .prepare<[number], ProductRow>("SELECT * FROM products WHERE id = ?")
      .get(sku.product_id);
    if (!product || !product.active) {
      throw new PurchaseError("That product is no longer available.");
    }
    if (product.sale_type === "limited") {
      const releaseAt = product.release_at ? Date.parse(product.release_at) : 0;
      if (releaseAt > Date.now()) {
        throw new PurchaseError("This limited release isn't live yet.");
      }
      if (product.per_account_limit != null) {
        const { total } = db
          .prepare<[number, number], { total: number | null }>(
            `SELECT SUM(oi.quantity) AS total
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             WHERE o.user_id = ? AND oi.product_id = ?`,
          )
          .get(user.id, product.id) ?? { total: 0 };
        const already = total ?? 0;
        if (already + qty > product.per_account_limit) {
          throw new PurchaseError(
            `Per-account limit is ${product.per_account_limit} for this item; you've already ordered ${already}.`,
          );
        }
      }
    }
    if (sku.stock < qty) {
      throw new PurchaseError(`Only ${sku.stock} left in stock for that colour/size.`);
    }

    db.prepare("UPDATE skus SET stock = stock - ? WHERE id = ?").run(qty, sku.id);

    let orderId: number;
    try {
      const orderInfo = db
        .prepare("INSERT INTO orders (user_id, status, idempotency_key) VALUES (?, 'confirmed', ?)")
        .run(user.id, idempotencyKey);
      orderId = Number(orderInfo.lastInsertRowid);
    } catch (err) {
      // Raced with another request using the same idempotency key: return
      // the order that won instead of erroring.
      const raced = db
        .prepare<[string], OrderRow>("SELECT * FROM orders WHERE idempotency_key = ?")
        .get(idempotencyKey);
      if (raced) return raced;
      throw err;
    }

    db.prepare(
      `INSERT INTO order_items
        (order_id, product_id, sku_id, product_name_snapshot, color_snapshot, size_snapshot, unit_price_cents_snapshot, quantity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(orderId, product.id, sku.id, product.name, sku.color, sku.size, product.price_cents, qty);

    recordOrderEvent(orderId, "placed", `Order #${orderId} placed successfully.`);

    return db.prepare<[number], OrderRow>("SELECT * FROM orders WHERE id = ?").get(orderId)!;
  });

  try {
    const order = runPurchase();
    res.redirect(`/orders/${order.id}`);
  } catch (err) {
    const message = err instanceof PurchaseError ? err.message : "Order failed — please try again.";
    res.status(err instanceof PurchaseError ? 409 : 500).send(
      layout({
        title: "Order failed",
        user: req.session.user,
        csrfToken: csrfToken(req),
        body: `<h1>Order failed</h1><p class="notice notice--error" role="alert">${escapeHtml(message)}</p>`,
      }),
    );
  }
});
