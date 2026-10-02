import type { ProductRow } from "../types.ts";
import { escapeHtml, money, when } from "./html.ts";

export function limitedPage(products: ProductRow[], now: number): string {
  return `
  <h1>Limited Releases</h1>
  ${
    products.length === 0
      ? `<p>No limited releases right now.</p>`
      : `<ul class="product-grid">
          ${products
            .map((p) => {
              const releaseAt = p.release_at ? Date.parse(p.release_at) : 0;
              const isLive = releaseAt <= now;
              return `<li class="product-card">
                <a href="/products/${encodeURIComponent(p.slug)}">
                  <img src="${escapeHtml(p.image_path)}" alt="" class="product-card__image" width="320" height="240" />
                  <h3>${escapeHtml(p.name)}</h3>
                  <p class="product-card__price">${money(p.price_cents)}</p>
                  <p class="notice ${isLive ? "notice--success" : "notice--pending"}">
                    ${isLive ? "Live now" : `Releases ${escapeHtml(p.release_at ?? "")}`}
                  </p>
                  ${when(p.per_account_limit, `<p>Limit ${p.per_account_limit} per account</p>`)}
                </a>
              </li>`;
            })
            .join("")}
        </ul>`
  }
  `;
}
