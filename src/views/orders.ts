import type { OrderRow } from "../types.ts";
import { escapeHtml } from "./html.ts";

export function ordersPage(orders: OrderRow[]): string {
  return `
  <h1>My Orders</h1>
  ${
    orders.length === 0
      ? `<p>You haven't placed any orders yet. <a href="/">Browse products</a>.</p>`
      : `<table class="data-table">
          <thead>
            <tr><th>Order</th><th>Status</th><th>Placed</th></tr>
          </thead>
          <tbody>
            ${orders
              .map(
                (o) => `<tr>
                  <td><a href="/orders/${o.id}">#${o.id}</a></td>
                  <td><span class="badge">${escapeHtml(o.status)}</span></td>
                  <td>${escapeHtml(o.created_at)}</td>
                </tr>`,
              )
              .join("")}
          </tbody>
        </table>`
  }
  `;
}
