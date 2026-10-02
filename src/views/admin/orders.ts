import type { OrderRow, OrderStatus } from "../../types.ts";
import { escapeHtml } from "../html.ts";

const STATUSES: OrderStatus[] = ["confirmed", "ready_for_pickup", "completed"];
const TERMINAL_STATUSES: OrderStatus[] = ["completed", "cancelled"];

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
        .map((o) => {
          const terminal = TERMINAL_STATUSES.includes(o.status);
          return `<tr>
            <td>#${o.id}</td>
            <td>${escapeHtml(o.user_email)}</td>
            <td><span class="badge ${o.status === "cancelled" ? "badge--soldout" : o.status === "completed" ? "badge--live" : "badge--pending"}">${escapeHtml(o.status)}</span></td>
            <td>${escapeHtml(o.created_at)}</td>
            <td>
              ${
                terminal
                  ? `<span class="visually-hidden">No further updates available</span>`
                  : `<form method="post" action="/admin/orders/${o.id}/status" class="inline-form">
                      <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}" />
                      <label class="visually-hidden" for="status-${o.id}">Status for order ${o.id}</label>
                      <select id="status-${o.id}" name="status">
                        ${STATUSES.map((s) => `<option value="${s}" ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}
                      </select>
                      <button type="submit" class="button">Update</button>
                    </form>
                    <form method="post" action="/admin/orders/${o.id}/status" class="inline-form"
                          onsubmit="return confirm('Cancel order #${o.id}? This returns its stock and cannot be undone.');">
                      <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}" />
                      <input type="hidden" name="status" value="cancelled" />
                      <button type="submit" class="button button--outline">Cancel order</button>
                    </form>`
              }
            </td>
          </tr>`;
        })
        .join("")}
    </tbody>
  </table>
  `;
}
