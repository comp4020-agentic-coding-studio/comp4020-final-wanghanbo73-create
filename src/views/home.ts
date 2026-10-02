import type { ProductRow } from "../types.ts";
import { escapeHtml, money } from "./html.ts";

export function productCard(p: ProductRow, badgeHtml = ""): string {
  return `<li class="product-card">
    <a href="/products/${encodeURIComponent(p.slug)}">
      <div class="product-card__image-wrap">
        <img src="${escapeHtml(p.image_path)}" alt="" class="product-card__image" width="320" height="240" />
        ${badgeHtml ? `<div class="badge-row">${badgeHtml}</div>` : ""}
      </div>
      <p class="product-card__category">${escapeHtml(p.category)}</p>
      <h3>${escapeHtml(p.name)}</h3>
      <p class="product-card__price">${money(p.price_cents)}</p>
    </a>
  </li>`;
}

export function homePage(products: ProductRow[]): string {
  return `
  <section class="hero">
    <div>
      <span class="hero__eyebrow">Clothing &amp; footwear</span>
      <h1 class="hero__title">Made in small batches, built to last.</h1>
      <p class="hero__subtitle">
        Regular stock and limited drops, all in one place. Pick a colour and
        size, check out, and track your order — no account required to browse.
      </p>
      <div class="hero__actions">
        <a href="#catalogue" class="button button--primary">Shop the catalogue</a>
        <a href="/limited" class="button button--outline">See limited drops</a>
      </div>
    </div>
    <div class="hero__visual" aria-hidden="true">
      ${products
        .slice(0, 3)
        .map((p) => `<img src="${escapeHtml(p.image_path)}" alt="" />`)
        .join("")}
    </div>
  </section>
  <h2 id="catalogue" class="section-eyebrow">The catalogue</h2>
  ${
    products.length === 0
      ? `<p>No products available right now.</p>`
      : `<ul class="product-grid">${products
          .map((p) => productCard(p, p.sale_type === "limited" ? `<span class="badge">Limited</span>` : ""))
          .join("")}</ul>`
  }
  `;
}
