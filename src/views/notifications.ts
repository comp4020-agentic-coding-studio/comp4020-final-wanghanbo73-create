import type { NotificationRow } from "../notifications.ts";
import { escapeHtml } from "./html.ts";

export function notificationsPage(notifications: NotificationRow[], csrfToken: string): string {
  return `
  <h1>Notifications</h1>
  ${
    notifications.length === 0
      ? `<p>No notifications yet. You'll see updates here when you place an order or its status changes.</p>`
      : `<ul class="notification-list">
          ${notifications
            .map(
              (n) => `<li class="notice ${n.type === "cancelled" ? "notice--error" : "notice--success"} notification${n.read ? " notification--read" : ""}">
                <div class="notification__body">
                  <p>${escapeHtml(n.message)}</p>
                  <p class="notification__meta">
                    <a href="/orders/${n.order_id}">View order #${n.order_id}</a>
                    · ${escapeHtml(n.created_at)}
                    · <span class="badge ${n.read ? "" : "badge--pending"}">${n.read ? "Read" : "Unread"}</span>
                  </p>
                </div>
                ${
                  n.read
                    ? ""
                    : `<form method="post" action="/notifications/${n.id}/read" class="inline-form">
                        <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}" />
                        <button type="submit" class="button button--outline">Mark as read</button>
                      </form>`
                }
              </li>`,
            )
            .join("")}
        </ul>`
  }
  `;
}
