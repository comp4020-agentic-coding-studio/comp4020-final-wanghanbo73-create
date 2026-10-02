import type { OrderRow, OrderStatus } from "../../types.ts";
import { escapeHtml } from "../html.ts";

const STATUSES: OrderStatus[] = ["confirmed", "ready_for_pickup", "completed"];

export interface AdminOrderRow extends OrderRow {
  user_email: string;
}

export function adminOrdersPage(orders: AdminOrderRow[], csrfToken: string): string {
  return `
  <h1>Orders</h1>
  <table class="data-table">
    <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Placed</th><th>Update</th></tr></thead>
    <tbody>
      ${orders
        .map(
          (o) => `<tr>
            <td>#${o.id}</td>
            <td>${escapeHtml(o.user_email)}</td>
            <td>${escapeHtml(o.status)}</td>
            <td>${escapeHtml(o.created_at)}</td>
            <td>
              <form method="post" action="/admin/orders/${o.id}/status" class="inline-form">
                <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}" />
                <label class="visually-hidden" for="status-${o.id}">Status for order ${o.id}</label>
                <select id="status-${o.id}" name="status">
                  ${STATUSES.map((s) => `<option value="${s}" ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}
                </select>
                <button type="submit" class="button">Update</button>
              </form>
            </td>
          </tr>`,
        )
        .join("")}
    </tbody>
  </table>
  `;
}
