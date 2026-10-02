import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { hashPassword } from "./auth.ts";

const dataDir = process.env.DATA_DIR ?? "./data";
mkdirSync(dataDir, { recursive: true });

export const db = new Database(join(dataDir, "app.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('customer','admin')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('clothing','footwear')),
    sale_type TEXT NOT NULL CHECK (sale_type IN ('regular','limited')),
    active INTEGER NOT NULL DEFAULT 1,
    release_at TEXT,
    per_account_limit INTEGER,
    image_path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS skus (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    color TEXT NOT NULL,
    size TEXT NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    UNIQUE (product_id, color, size)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL CHECK (status IN ('confirmed','ready_for_pickup','completed','cancelled')) DEFAULT 'confirmed',
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    product_id INTEGER NOT NULL,
    sku_id INTEGER NOT NULL,
    product_name_snapshot TEXT NOT NULL,
    color_snapshot TEXT NOT NULL,
    size_snapshot TEXT NOT NULL,
    unit_price_cents_snapshot INTEGER NOT NULL,
    quantity INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS order_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    type TEXT NOT NULL CHECK (type IN ('placed','status_changed','cancelled')),
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notification_reads (
    user_id INTEGER NOT NULL REFERENCES users(id),
    event_id INTEGER NOT NULL REFERENCES order_events(id),
    read_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, event_id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
`);

// Widen the orders.status CHECK to allow 'cancelled'. CREATE TABLE IF NOT
// EXISTS above is a no-op against a DB file created before this column
// constraint existed, so an already-deployed volume still has the old
// CHECK and would reject a cancellation. SQLite can't ALTER a CHECK
// constraint in place — rebuild the table, preserving every row.
function migrateOrdersStatusCheck(): void {
  const table = db
    .prepare<[], { sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'")
    .get();
  const orderItems = db
    .prepare<[], { sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'order_items'")
    .get();
  const orderEvents = db
    .prepare<[], { sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'order_events'")
    .get();
  // A table rename makes SQLite auto-rewrite every OTHER table's REFERENCES
  // clauses to point at the new name — so renaming orders -> orders_old
  // silently repoints order_items/order_events at orders_old, which then
  // breaks once orders_old is dropped. `legacy_alter_table` turns that
  // auto-rewrite off. The `needsFkRepair` checks are a one-time fix for any
  // DB file this bug already ran against (tables left pointing at a dropped
  // 'orders_old').
  const needsCheckMigration = !table || !table.sql.includes("'cancelled'");
  const needsItemsFkRepair = orderItems && orderItems.sql.includes("orders_old");
  const needsEventsFkRepair = orderEvents && orderEvents.sql.includes("orders_old");
  if (!table || (!needsCheckMigration && !needsItemsFkRepair && !needsEventsFkRepair)) return;

  db.pragma("foreign_keys = OFF");
  db.pragma("legacy_alter_table = ON");
  try {
    db.transaction(() => {
      if (needsCheckMigration) {
        db.exec(`
          ALTER TABLE orders RENAME TO orders_old;
          CREATE TABLE orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            status TEXT NOT NULL CHECK (status IN ('confirmed','ready_for_pickup','completed','cancelled')) DEFAULT 'confirmed',
            idempotency_key TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO orders (id, user_id, status, idempotency_key, created_at)
            SELECT id, user_id, status, idempotency_key, created_at FROM orders_old;
          DROP TABLE orders_old;
        `);
      }
      if (needsItemsFkRepair || needsCheckMigration) {
        db.exec(`
          ALTER TABLE order_items RENAME TO order_items_old;
          CREATE TABLE order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL REFERENCES orders(id),
            product_id INTEGER NOT NULL,
            sku_id INTEGER NOT NULL,
            product_name_snapshot TEXT NOT NULL,
            color_snapshot TEXT NOT NULL,
            size_snapshot TEXT NOT NULL,
            unit_price_cents_snapshot INTEGER NOT NULL,
            quantity INTEGER NOT NULL
          );
          INSERT INTO order_items
            (id, order_id, product_id, sku_id, product_name_snapshot, color_snapshot, size_snapshot, unit_price_cents_snapshot, quantity)
            SELECT id, order_id, product_id, sku_id, product_name_snapshot, color_snapshot, size_snapshot, unit_price_cents_snapshot, quantity
            FROM order_items_old;
          DROP TABLE order_items_old;
        `);
      }
      if (needsEventsFkRepair) {
        db.exec(`
          ALTER TABLE order_events RENAME TO order_events_old;
          CREATE TABLE order_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL REFERENCES orders(id),
            type TEXT NOT NULL CHECK (type IN ('placed','status_changed','cancelled')),
            message TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO order_events (id, order_id, type, message, created_at)
            SELECT id, order_id, type, message, created_at FROM order_events_old;
          DROP TABLE order_events_old;
        `);
      }
    })();
  } finally {
    db.pragma("legacy_alter_table = OFF");
    db.pragma("foreign_keys = ON");
  }
}

migrateOrdersStatusCheck();

interface SeedSku {
  color: string;
  size: string;
  stock: number;
}

interface SeedProduct {
  slug: string;
  name: string;
  description: string;
  price_cents: number;
  category: "clothing" | "footwear";
  sale_type: "regular" | "limited";
  release_at: string | null;
  per_account_limit: number | null;
  image_path: string;
  skus: SeedSku[];
}

const FUTURE_RELEASE = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();

const SEED_PRODUCTS: SeedProduct[] = [
  {
    slug: "classic-tee",
    name: "Classic Tee",
    description: "A soft, everyday cotton t-shirt in three colourways.",
    price_cents: 2500,
    category: "clothing",
    sale_type: "regular",
    release_at: null,
    per_account_limit: null,
    image_path: "/images/classic-tee.svg",
    skus: [
      { color: "Black", size: "S", stock: 12 },
      { color: "Black", size: "M", stock: 8 },
      { color: "White", size: "M", stock: 5 },
    ],
  },
  {
    slug: "canvas-hoodie",
    name: "Canvas Hoodie",
    description: "Heavyweight fleece hoodie, relaxed fit.",
    price_cents: 6500,
    category: "clothing",
    sale_type: "regular",
    release_at: null,
    per_account_limit: null,
    image_path: "/images/canvas-hoodie.svg",
    skus: [
      { color: "Grey", size: "M", stock: 10 },
      { color: "Grey", size: "L", stock: 6 },
      { color: "Navy", size: "L", stock: 4 },
    ],
  },
  {
    slug: "utility-jacket",
    name: "Utility Jacket",
    description: "Water-resistant shell jacket for cooler days.",
    price_cents: 9000,
    category: "clothing",
    sale_type: "regular",
    release_at: null,
    per_account_limit: null,
    image_path: "/images/utility-jacket.svg",
    skus: [
      { color: "Olive", size: "M", stock: 7 },
      { color: "Olive", size: "L", stock: 3 },
    ],
  },
  {
    slug: "relaxed-chinos",
    name: "Relaxed Chinos",
    description: "Everyday chinos with a tapered leg.",
    price_cents: 5500,
    category: "clothing",
    sale_type: "regular",
    release_at: null,
    per_account_limit: null,
    image_path: "/images/relaxed-chinos.svg",
    skus: [
      { color: "Khaki", size: "30", stock: 9 },
      { color: "Khaki", size: "32", stock: 9 },
      { color: "Black", size: "32", stock: 6 },
    ],
  },
  {
    slug: "trail-runner",
    name: "Trail Runner",
    description: "Lightweight trainer built for mixed terrain.",
    price_cents: 11000,
    category: "footwear",
    sale_type: "regular",
    release_at: null,
    per_account_limit: null,
    image_path: "/images/trail-runner.svg",
    skus: [
      { color: "Charcoal", size: "9", stock: 5 },
      { color: "Charcoal", size: "10", stock: 5 },
      { color: "Red", size: "10", stock: 3 },
    ],
  },
  {
    slug: "court-classic",
    name: "Court Classic",
    description: "Minimalist leather sneaker.",
    price_cents: 9500,
    category: "footwear",
    sale_type: "regular",
    release_at: null,
    per_account_limit: null,
    image_path: "/images/court-classic.svg",
    skus: [
      { color: "White", size: "9", stock: 8 },
      { color: "White", size: "10", stock: 8 },
    ],
  },
  {
    slug: "drop-puffer",
    name: "Drop Puffer (Limited)",
    description: "Limited-release puffer jacket, numbered run.",
    price_cents: 15000,
    category: "clothing",
    sale_type: "limited",
    release_at: FUTURE_RELEASE,
    per_account_limit: 1,
    image_path: "/images/drop-puffer.svg",
    skus: [
      { color: "Black", size: "M", stock: 4 },
      { color: "Black", size: "L", stock: 4 },
    ],
  },
  {
    slug: "drop-hitops",
    name: "Drop Hi-Tops (Limited)",
    description: "Limited-release high-top sneaker collab.",
    price_cents: 13000,
    category: "footwear",
    sale_type: "limited",
    release_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    per_account_limit: 2,
    image_path: "/images/drop-hitops.svg",
    skus: [
      { color: "Cream", size: "9", stock: 3 },
      { color: "Cream", size: "10", stock: 3 },
    ],
  },
];

function seed(): void {
  const insertProduct = db.prepare(`
    INSERT OR IGNORE INTO products
      (slug, name, description, price_cents, category, sale_type, active, release_at, per_account_limit, image_path)
    VALUES (@slug, @name, @description, @price_cents, @category, @sale_type, 1, @release_at, @per_account_limit, @image_path)
  `);
  const getProductId = db.prepare<[string], { id: number }>("SELECT id FROM products WHERE slug = ?");
  const insertSku = db.prepare(`
    INSERT OR IGNORE INTO skus (product_id, color, size, stock)
    VALUES (@product_id, @color, @size, @stock)
  `);

  const seedAll = db.transaction(() => {
    for (const p of SEED_PRODUCTS) {
      insertProduct.run(p);
      const row = getProductId.get(p.slug);
      if (!row) continue;
      for (const s of p.skus) {
        insertSku.run({ product_id: row.id, color: s.color, size: s.size, stock: s.stock });
      }
    }
  });
  seedAll();

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(adminEmail);
    if (!existing) {
      const passwordHash = hashPassword(adminPassword);
      db.prepare(
        "INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'admin')",
      ).run(adminEmail, passwordHash);
      console.log(`[db] seeded admin account ${adminEmail}`);
    }
  } else {
    console.warn(
      "[db] ADMIN_EMAIL/ADMIN_PASSWORD not set — no admin account seeded; /admin is unreachable until one exists",
    );
  }
}

seed();
