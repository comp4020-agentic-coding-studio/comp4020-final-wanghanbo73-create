import type { ProductRow } from "../types.ts";
import { escapeHtml, money } from "./html.ts";

export function productCard(p: ProductRow): string {
  return `<li class="product-card">
    <a href="/products/${encodeURIComponent(p.slug)}">
      <img src="${escapeHtml(p.image_path)}" alt="" class="product-card__image" width="320" height="240" />
      <h3>${escapeHtml(p.name)}</h3>
      <p class="product-card__price">${money(p.price_cents)}</p>
      <p class="product-card__category">${escapeHtml(p.category)}</p>
    </a>
  </li>`;
}

export function homePage(products: ProductRow[]): string {
  return `
  <h1>Fieldmark</h1>
  <p>Clothing and footwear, made in small batches. Regular stock and limited drops, all in one place.</p>
  ${
    products.length === 0
      ? `<p>No products available right now.</p>`
      : `<ul class="product-grid">${products.map(productCard).join("")}</ul>`
  }
  `;
}
