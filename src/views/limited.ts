import type { ProductRow } from "../types.ts";
import { escapeHtml, money, when } from "./html.ts";

export function limitedPage(products: ProductRow[], now: number): string {
  return `
  <span class="hero__eyebrow">Limited releases</span>
  <h1>Drops with a release time and a per-account limit</h1>
  <p class="hero__subtitle">Each item below is capped per account and unlocks at its own release time — place an order the moment it goes live.</p>
  ${
    products.length === 0
      ? `<p>No limited releases right now.</p>`
      : `<ul class="product-grid">
          ${products
            .map((p) => {
              const releaseAt = p.release_at ? Date.parse(p.release_at) : 0;
              const isLive = releaseAt <= now;
              const badge = `<span class="badge ${isLive ? "badge--live" : "badge--pending"}">${
                isLive ? "Live now" : "Upcoming"
              }</span>`;
              return `<li class="product-card">
                <a href="/products/${encodeURIComponent(p.slug)}">
                  <div class="product-card__image-wrap">
                    <img src="${escapeHtml(p.image_path)}" alt="" class="product-card__image" width="320" height="240" />
                    <div class="badge-row">${badge}</div>
                  </div>
                  <p class="product-card__category">${escapeHtml(p.category)}</p>
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
