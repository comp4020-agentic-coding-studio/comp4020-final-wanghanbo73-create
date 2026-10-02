import type { OrderItemRow, OrderRow } from "../types.ts";
import { escapeHtml, money } from "./html.ts";

export function orderDetailPage(order: OrderRow, items: OrderItemRow[]): string {
  const total = items.reduce((sum, i) => sum + i.unit_price_cents_snapshot * i.quantity, 0);
  return `
  <h1>Order #${order.id}</h1>
  <p>Status: <span class="badge badge--live">${escapeHtml(order.status)}</span></p>
  <p>Placed: ${escapeHtml(order.created_at)}</p>
  <table class="data-table">
    <thead>
      <tr><th>Item</th><th>Colour/Size</th><th>Qty</th><th>Unit price</th><th>Line total</th></tr>
    </thead>
    <tbody>
      ${items
        .map(
          (i) => `<tr>
            <td>${escapeHtml(i.product_name_snapshot)}</td>
            <td>${escapeHtml(i.color_snapshot)} / ${escapeHtml(i.size_snapshot)}</td>
            <td>${i.quantity}</td>
            <td>${money(i.unit_price_cents_snapshot)}</td>
            <td>${money(i.unit_price_cents_snapshot * i.quantity)}</td>
          </tr>`,
        )
        .join("")}
    </tbody>
    <tfoot>
      <tr><td colspan="4">Total</td><td><strong>${money(total)}</strong></td></tr>
    </tfoot>
  </table>
  `;
}
