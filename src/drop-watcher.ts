// Announces a limited product going live the moment its release_at passes,
// without requiring anyone to reload the page. See
// docs/adr/0004-drop-urgency-signals.md for why this is worth the extra
// moving part: a drop that silently "went live 40 seconds ago" to anyone
// who isn't manually refreshing is a worse demo of real-time correctness
// than the stock/order pushes the app already had.
//
// Purely additive: this reads already-committed product rows on a timer and
// publishes, it never writes anything. announced below exists so a given
// product is only ever pushed once per process lifetime, not every tick.
import { db } from "./db.ts";
import { publish } from "./realtime.ts";
import type { ProductRow } from "./types.ts";

const announced = new Set<number>();

function checkForNewlyLiveDrops(): void {
  const now = new Date().toISOString();
  const rows = db
    .prepare<[string], ProductRow>(
      "SELECT * FROM products WHERE active = 1 AND sale_type = 'limited' AND release_at IS NOT NULL AND release_at <= ?",
    )
    .all(now);
  for (const product of rows) {
    if (announced.has(product.id)) continue;
    announced.add(product.id);
    publish("catalog", "product_live", { productId: product.id });
  }
}

export function startDropWatcher(intervalMs = 5_000): void {
  // Run once immediately so a drop whose release_at already passed before
  // boot doesn't wait a full interval to be marked as announced (it won't
  // re-announce on every future boot either way, since it's already live).
  checkForNewlyLiveDrops();
  setInterval(checkForNewlyLiveDrops, intervalMs).unref();
}
