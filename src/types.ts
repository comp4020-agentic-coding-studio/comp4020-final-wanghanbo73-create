// Shared row/session types. Kept in one place so routes/views agree on shape.

export type Role = "customer" | "admin";

export interface SessionUser {
  id: number;
  email: string;
  role: Role;
}

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  role: Role;
  created_at: string;
}

export type Category = "clothing" | "footwear";
export type SaleType = "regular" | "limited";

export interface ProductRow {
  id: number;
  slug: string;
  name: string;
  description: string;
  price_cents: number;
  category: Category;
  sale_type: SaleType;
  active: number; // 0/1
  release_at: string | null;
  per_account_limit: number | null;
  image_path: string;
  created_at: string;
}

export interface SkuRow {
  id: number;
  product_id: number;
  color: string;
  size: string;
  stock: number;
}

export type OrderStatus = "confirmed" | "ready_for_pickup" | "completed" | "cancelled";

export interface OrderRow {
  id: number;
  user_id: number;
  status: OrderStatus;
  idempotency_key: string;
  created_at: string;
}

export interface OrderItemRow {
  id: number;
  order_id: number;
  product_id: number;
  sku_id: number;
  product_name_snapshot: string;
  color_snapshot: string;
  size_snapshot: string;
  unit_price_cents_snapshot: number;
  quantity: number;
}

export type OrderEventType = "placed" | "status_changed" | "cancelled";

export interface OrderEventRow {
  id: number;
  order_id: number;
  type: OrderEventType;
  message: string;
  created_at: string;
}

// Declaration merging onto express-session's SessionData.
declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
  }
}
