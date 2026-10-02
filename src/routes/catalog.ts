import { Router } from "express";
import { db } from "../db.ts";
import type { ProductRow, SkuRow } from "../types.ts";
import { layout } from "../views/layout.ts";
import { homePage } from "../views/home.ts";
import { productPage } from "../views/product.ts";
import { limitedPage } from "../views/limited.ts";
import { csrfToken } from "../csrf.ts";

export const catalogRouter = Router();

catalogRouter.get("/", (req, res) => {
  const products = db
    .prepare<[], ProductRow>(
      "SELECT * FROM products WHERE active = 1 ORDER BY sale_type DESC, name ASC",
    )
    .all();
  res.send(
    layout({
      title: "Home",
      user: req.session.user,
      csrfToken: csrfToken(req),
      body: homePage(products),
    }),
  );
});

catalogRouter.get("/limited", (req, res) => {
  const products = db
    .prepare<[], ProductRow>(
      "SELECT * FROM products WHERE active = 1 AND sale_type = 'limited' ORDER BY release_at ASC",
    )
    .all();
  res.send(
    layout({
      title: "Limited releases",
      user: req.session.user,
      csrfToken: csrfToken(req),
      body: limitedPage(products, Date.now()),
    }),
  );
});

catalogRouter.get("/products/:slug", (req, res) => {
  const product = db
    .prepare<[string], ProductRow>("SELECT * FROM products WHERE slug = ? AND active = 1")
    .get(req.params.slug);
  if (!product) {
    res.status(404).send(
      layout({
        title: "Not found",
        user: req.session.user,
        csrfToken: csrfToken(req),
        body: "<h1>Product not found</h1>",
      }),
    );
    return;
  }
  const skus = db
    .prepare<[number], SkuRow>("SELECT * FROM skus WHERE product_id = ? ORDER BY color, size")
    .all(product.id);
  const isLive =
    product.sale_type === "regular" ||
    !product.release_at ||
    Date.parse(product.release_at) <= Date.now();
  res.send(
    layout({
      title: product.name,
      user: req.session.user,
      csrfToken: csrfToken(req),
      body: productPage({ product, skus, isLive }),
    }),
  );
});
