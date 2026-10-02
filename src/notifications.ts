import { db } from "./db.ts";
import type { OrderEventRow, OrderEventType } from "./types.ts";

// Called from inside an existing db.transaction(...) callback — this is a
// single prepared statement, not its own transaction, so it stays atomic
// with whatever order/stock mutation it's paired with.
export function recordOrderEvent(orderId: number, type: OrderEventType, message: string): void {
  db.prepare("INSERT INTO order_events (order_id, type, message) VALUES (?, ?, ?)").run(
    orderId,
    type,
    message,
  );
}

export function getUnreadCount(userId: number): number {
  const row = db
    .prepare<[number, number], { n: number }>(
      `SELECT COUNT(*) AS n
       FROM order_events oe
       JOIN orders o ON o.id = oe.order_id
       WHERE o.user_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM notification_reads nr WHERE nr.user_id = ? AND nr.event_id = oe.id
         )`,
    )
    .get(userId, userId);
  return row?.n ?? 0;
}

export interface NotificationRow extends OrderEventRow {
  read: 0 | 1;
}

export function listNotifications(userId: number): NotificationRow[] {
  return db
    .prepare<[number, number], NotificationRow>(
      `SELECT oe.*,
         CASE WHEN nr.user_id IS NULL THEN 0 ELSE 1 END AS read
       FROM order_events oe
       JOIN orders o ON o.id = oe.order_id
       LEFT JOIN notification_reads nr ON nr.event_id = oe.id AND nr.user_id = ?
       WHERE o.user_id = ?
       ORDER BY oe.id DESC`,
    )
    .all(userId, userId);
}
