import type { ProductRow, SkuRow } from "../types.ts";
import { escapeHtml, money } from "./html.ts";

export interface CheckoutPageOptions {
  product: ProductRow;
  sku: SkuRow;
  qty: number;
  csrfToken: string;
  idempotencyKey: string;
}

export function checkoutPage({
  product,
  sku,
  qty,
  csrfToken,
  idempotencyKey,
}: CheckoutPageOptions): string {
  const total = product.price_cents * qty;
  return `
  <div class="panel">
    <h1>Confirm your order</h1>
    <dl class="checkout-summary">
      <dt>Item</dt>
      <dd>${escapeHtml(product.name)} — ${escapeHtml(sku.color)} / ${escapeHtml(sku.size)}</dd>
      <dt>Quantity</dt>
      <dd>${qty}</dd>
      <dt>Unit price</dt>
      <dd>${money(product.price_cents)}</dd>
      <dt>Total</dt>
      <dd><strong>${money(total)}</strong></dd>
    </dl>
    <p class="notice">This is a course demo — simulated checkout, no real charge.</p>
    <form method="post" action="/buy">
      <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}" />
      <input type="hidden" name="idempotency_key" value="${escapeHtml(idempotencyKey)}" />
      <input type="hidden" name="sku_id" value="${sku.id}" />
      <input type="hidden" name="qty" value="${qty}" />
      <button type="submit" class="button button--primary">Place order</button>
    </form>
  </div>
  `;
}
