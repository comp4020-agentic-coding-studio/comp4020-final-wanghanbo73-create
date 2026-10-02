import type { ProductRow, SkuRow } from "../types.ts";
import { escapeHtml, money, when } from "./html.ts";

export interface ProductPageOptions {
  product: ProductRow;
  skus: SkuRow[];
  isLive: boolean;
}

export function productPage({ product, skus, isLive }: ProductPageOptions): string {
  const limitedNotice =
    product.sale_type === "limited"
      ? `<p class="notice notice--limited">
          Limited release.
          ${
            isLive
              ? "Available now."
              : `Available from ${escapeHtml(product.release_at ?? "")}.`
          }
          ${when(
            product.per_account_limit,
            `Limit ${product.per_account_limit} per account.`,
          )}
        </p>`
      : "";

  const skuOptions = skus
    .map((s) => {
      const soldOut = s.stock <= 0;
      return `<option value="${s.id}" data-stock="${s.stock}" ${soldOut ? "disabled" : ""}>
        ${escapeHtml(s.color)} / ${escapeHtml(s.size)} — ${soldOut ? "SOLD OUT" : `${s.stock} in stock`}
      </option>`;
    })
    .join("");

  return `
  <article class="product-detail">
    <img src="${escapeHtml(product.image_path)}" alt="" class="product-detail__image" width="480" height="360" />
    <div class="product-detail__info">
      <h1>${escapeHtml(product.name)}</h1>
      <p class="product-detail__price">${money(product.price_cents)}</p>
      <p>${escapeHtml(product.description)}</p>
      ${limitedNotice}
      ${when(!isLive, `<p class="notice notice--error">This item is not available for purchase yet.</p>`)}
      <form method="get" action="/checkout" class="purchase-form">
        <div class="field">
          <label for="sku">Colour / Size</label>
          <select id="sku" name="sku" required ${!isLive ? "disabled" : ""}>
            <option value="">Choose an option</option>
            ${skuOptions}
          </select>
        </div>
        <div class="field">
          <label for="qty">Quantity</label>
          <input id="qty" name="qty" type="number" min="1" value="1" required ${!isLive ? "disabled" : ""} />
        </div>
        <button type="submit" class="button button--primary" ${!isLive ? "disabled" : ""}>
          ${isLive ? "Buy" : "Not available yet"}
        </button>
      </form>
    </div>
  </article>
  `;
}
