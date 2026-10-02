import { Router } from "express";
import type { Request, Response } from "express";
import { db } from "../db.ts";
import { requireAdmin } from "../auth.ts";
import { csrfToken } from "../csrf.ts";
import { layout } from "../views/layout.ts";
import { adminDashboardPage } from "../views/admin/dashboard.ts";
import { adminProductsPage } from "../views/admin/products.ts";
import { productEditPage } from "../views/admin/product-edit.ts";
import { adminOrdersPage } from "../views/admin/orders.ts";
import type { AdminOrderRow } from "../views/admin/orders.ts";
import { newAdminPage } from "../views/admin/new-admin.ts";
import type { Category, OrderItemRow, OrderRow, OrderStatus, ProductRow, SaleType, SkuRow, UserRow } from "../types.ts";
import { escapeHtml } from "../views/html.ts";
import { recordOrderEvent } from "../notifications.ts";
import { hashPassword } from "../auth.ts";

export const adminRouter = Router();
adminRouter.use(requireAdmin);

function render(req: Request, res: Response, title: string, body: string, status = 200): void {
  res.status(status).send(
    layout({ title, user: req.session.user, csrfToken: csrfToken(req), body }),
  );
}

adminRouter.get("/", (req, res) => {
  const products = db.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM products").get()!.n;
  const activeProducts = db
    .prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM products WHERE active = 1")
    .get()!.n;
  const orders = db.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM orders").get()!.n;
  const users = db
    .prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'")
    .get()!.n;
  render(req, res, "Admin Dashboard", adminDashboardPage({ products, activeProducts, orders, users }));
});

adminRouter.get("/products", (req, res) => {
  const products = db.prepare<[], ProductRow>("SELECT * FROM products ORDER BY name").all();
  render(req, res, "Products", adminProductsPage(products, csrfToken(req)));
});

adminRouter.get("/products/new", (req, res) => {
  render(req, res, "New product", productEditPage({ skus: [], csrfToken: csrfToken(req) }));
});

function parseProductBody(body: Record<string, unknown>): {
  name: string;
  slug: string;
  description: string;
  price_cents: number;
  category: Category;
  sale_type: SaleType;
  active: number;
  release_at: string | null;
  per_account_limit: number | null;
  image_path: string;
} | null {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const priceCents = Number(body.price_cents);
  const category = body.category === "footwear" ? "footwear" : body.category === "clothing" ? "clothing" : null;
  const saleType = body.sale_type === "limited" ? "limited" : body.sale_type === "regular" ? "regular" : null;
  const releaseAtRaw = typeof body.release_at === "string" ? body.release_at.trim() : "";
  const perAccountLimitRaw = Number(body.per_account_limit);
  const imagePath = typeof body.image_path === "string" && body.image_path.trim() ? body.image_path.trim() : "/images/placeholder.svg";

  if (!name || !slug || !description || !Number.isFinite(priceCents) || priceCents < 0 || !category || !saleType) {
    return null;
  }

  return {
    name,
    slug,
    description,
    price_cents: Math.round(priceCents),
    category,
    sale_type: saleType,
    active: body.active ? 1 : 0,
    release_at: saleType === "limited" && releaseAtRaw ? releaseAtRaw : null,
    per_account_limit:
      saleType === "limited" && Number.isFinite(perAccountLimitRaw) && perAccountLimitRaw > 0
        ? Math.round(perAccountLimitRaw)
        : null,
    image_path: imagePath,
  };
}

adminRouter.post("/products/new", (req, res) => {
  const parsed = parseProductBody(req.body);
  if (!parsed) {
    render(
      req,
      res,
      "New product",
      productEditPage({ skus: [], csrfToken: csrfToken(req), error: "Please fill in all required fields." }),
      400,
    );
    return;
  }
  try {
    db.prepare(
      `INSERT INTO products
        (slug, name, description, price_cents, category, sale_type, active, release_at, per_account_limit, image_path)
       VALUES (@slug, @name, @description, @price_cents, @category, @sale_type, @active, @release_at, @per_account_limit, @image_path)`,
    ).run(parsed);
  } catch {
    render(
      req,
      res,
      "New product",
      productEditPage({ skus: [], csrfToken: csrfToken(req), error: "That slug is already in use." }),
      409,
    );
    return;
  }
  res.redirect("/admin/products");
});

adminRouter.get("/products/:id/edit", (req, res) => {
  const id = Number(req.params.id);
  const product = db.prepare<[number], ProductRow>("SELECT * FROM products WHERE id = ?").get(id);
  if (!product) {
    render(req, res, "Not found", "<h1>Product not found</h1>", 404);
    return;
  }
  const skus = db
    .prepare<[number], SkuRow>("SELECT * FROM skus WHERE product_id = ? ORDER BY color, size")
    .all(id);
  render(req, res, `Edit ${product.name}`, productEditPage({ product, skus, csrfToken: csrfToken(req) }));
});

adminRouter.post("/products/:id/edit", (req, res) => {
  const id = Number(req.params.id);
  const product = db.prepare<[number], ProductRow>("SELECT * FROM products WHERE id = ?").get(id);
  if (!product) {
    render(req, res, "Not found", "<h1>Product not found</h1>", 404);
    return;
  }

  // Three distinct sub-forms post to the same URL: toggling active,
  // updating a SKU's stock, adding a new SKU, or the full edit form.
  if (req.body.toggle_active) {
    db.prepare("UPDATE products SET active = ? WHERE id = ?").run(product.active ? 0 : 1, id);
    res.redirect("/admin/products");
    return;
  }

  if (req.body.update_sku_id) {
    const skuId = Number(req.body.update_sku_id);
    const stock = Number(req.body.stock);
    if (Number.isInteger(skuId) && Number.isFinite(stock) && stock >= 0) {
      db.prepare("UPDATE skus SET stock = ? WHERE id = ? AND product_id = ?").run(
        Math.round(stock),
        skuId,
        id,
      );
    }
    res.redirect(`/admin/products/${id}/edit`);
    return;
  }

  if (req.body.add_sku) {
    const color = typeof req.body.color === "string" ? req.body.color.trim() : "";
    const size = typeof req.body.size === "string" ? req.body.size.trim() : "";
    const stock = Number(req.body.stock);
    if (color && size && Number.isFinite(stock) && stock >= 0) {
      try {
        db.prepare("INSERT INTO skus (product_id, color, size, stock) VALUES (?, ?, ?, ?)").run(
          id,
          color,
          size,
          Math.round(stock),
        );
      } catch {
        // duplicate (product_id, color, size) — ignore silently, admin can retry
      }
    }
    res.redirect(`/admin/products/${id}/edit`);
    return;
  }

  const parsed = parseProductBody(req.body);
  if (!parsed) {
    const skus = db
      .prepare<[number], SkuRow>("SELECT * FROM skus WHERE product_id = ? ORDER BY color, size")
      .all(id);
    render(
      req,
      res,
      `Edit ${product.name}`,
      productEditPage({
        product,
        skus,
        csrfToken: csrfToken(req),
        error: "Please fill in all required fields.",
      }),
      400,
    );
    return;
  }

  // Slug is immutable after creation (the edit form renders it readonly) —
  // keep the original regardless of what was submitted.
  db.prepare(
    `UPDATE products SET
      name = @name, description = @description, price_cents = @price_cents,
      category = @category, sale_type = @sale_type, active = @active,
      release_at = @release_at, per_account_limit = @per_account_limit, image_path = @image_path
     WHERE id = @id`,
  ).run({ ...parsed, id });

  res.redirect(`/admin/products/${id}/edit`);
});

adminRouter.get("/orders", (req, res) => {
  const orders = db
    .prepare<[], AdminOrderRow>(
      `SELECT o.*, u.email AS user_email
       FROM orders o JOIN users u ON u.id = o.user_id
       ORDER BY o.id DESC`,
    )
    .all();
  render(req, res, "Orders", adminOrdersPage(orders, csrfToken(req)));
});

const VALID_STATUSES: OrderStatus[] = ["confirmed", "ready_for_pickup", "completed", "cancelled"];
const TERMINAL_STATUSES: OrderStatus[] = ["completed", "cancelled"];

class StatusUpdateError extends Error {}

adminRouter.post("/orders/:id/status", (req, res) => {
  const id = Number(req.params.id);
  const status = req.body.status;
  if (!VALID_STATUSES.includes(status)) {
    render(req, res, "Orders", `<p class="notice notice--error">Invalid status: ${escapeHtml(String(status))}</p>`, 400);
    return;
  }

  // Re-read current status, validate, mutate stock + status, and log the
  // event all inside one transaction — no partial state if anything throws.
  const applyStatusChange = db.transaction((): void => {
    const order = db.prepare<[number], OrderRow>("SELECT * FROM orders WHERE id = ?").get(id);
    if (!order) throw new StatusUpdateError(`Order #${id} does not exist.`);
    if (order.status === status) return;
    if (TERMINAL_STATUSES.includes(order.status)) {
      throw new StatusUpdateError(`Order #${id} is already ${order.status} and can't be changed further.`);
    }

    if (status === "cancelled") {
      const items = db
        .prepare<[number], OrderItemRow>("SELECT * FROM order_items WHERE order_id = ?")
        .all(id);
      for (const item of items) {
        db.prepare("UPDATE skus SET stock = stock + ? WHERE id = ?").run(item.quantity, item.sku_id);
      }
      db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(id);
      recordOrderEvent(id, "cancelled", `Order #${id} was cancelled and the stock has been returned.`);
      return;
    }

    db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, id);
    recordOrderEvent(id, "status_changed", `Order #${id} status updated to ${status.replace(/_/g, " ")}.`);
  });

  try {
    applyStatusChange();
  } catch (err) {
    const message = err instanceof StatusUpdateError ? err.message : "Could not update order.";
    render(req, res, "Orders", `<p class="notice notice--error">${escapeHtml(message)}</p>`, err instanceof StatusUpdateError ? 409 : 500);
    return;
  }
  res.redirect("/admin/orders");
});

adminRouter.get("/admins/new", (req, res) => {
  render(req, res, "Create admin account", newAdminPage({ csrfToken: csrfToken(req) }));
});

adminRouter.post("/admins", (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";

  if (!email || !password || password.length < 8) {
    render(
      req,
      res,
      "Create admin account",
      newAdminPage({ csrfToken: csrfToken(req), error: "Email and a password of at least 8 characters are required." }),
      400,
    );
    return;
  }

  const existing = db.prepare<[string], UserRow>("SELECT * FROM users WHERE email = ?").get(email);
  if (existing) {
    render(
      req,
      res,
      "Create admin account",
      newAdminPage({ csrfToken: csrfToken(req), error: "An account with that email already exists." }),
      409,
    );
    return;
  }

  // Role is hardcoded here, never read from the request body — this is the
  // only HTTP path that creates an admin account, and it's gated by
  // requireAdmin above.
  db.prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'admin')").run(
    email,
    hashPassword(password),
  );

  res.redirect("/admin");
});
