import { randomUUID } from "node:crypto";
import { expect, inject, it } from "vitest";
import { CookieJar, extractCsrf, jarGet, jarPostForm, registerAndLogin } from "./test-helpers.ts";

const baseUrl = inject("baseUrl");

function parseStock(html: string, skuId: string): number {
  const re = new RegExp(`<option value="${skuId}" data-stock="(\\d+)"`);
  const m = html.match(re);
  if (!m) throw new Error(`sku ${skuId} not found on page`);
  return Number(m[1]);
}

// This DB persists across repeated local runs (redeploys never reset stock),
// so a SKU this test bought from on a previous run may already sit at 0. If
// admin creds are available, top it back up; otherwise return false so the
// caller can pick a different SKU or skip gracefully.
async function topUpStock(skuId: string, desired: number): Promise<boolean> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) return false;

  const jar = new CookieJar();
  const loginPage = await jarGet(jar, new URL("/login", baseUrl));
  const csrf = extractCsrf(await loginPage.text());
  const loginRes = await jarPostForm(jar, new URL("/login", baseUrl), {
    email: adminEmail,
    password: adminPassword,
    _csrf: csrf,
  });
  if (loginRes.status !== 302) return false;

  const productsHtml = await (await jarGet(jar, new URL("/admin/products", baseUrl))).text();
  const row = productsHtml.split("<tr>").find((r) => r.includes("Classic Tee"));
  const productId = row?.match(/\/admin\/products\/(\d+)\/edit/)?.[1];
  if (!productId) return false;

  const editPage = await jarGet(jar, new URL(`/admin/products/${productId}/edit`, baseUrl));
  const editCsrf = extractCsrf(await editPage.text());
  const updateRes = await jarPostForm(
    jar,
    new URL(`/admin/products/${productId}/edit`, baseUrl),
    { _csrf: editCsrf, update_sku_id: skuId, stock: String(desired) },
  );
  return updateRes.status === 302;
}

it("submitting the same idempotency key twice sequentially creates exactly one order", async () => {
  const { jar } = await registerAndLogin(baseUrl);
  let productHtml = await (await jarGet(jar, new URL("/products/classic-tee", baseUrl))).text();
  const skuId = productHtml.match(/option value="(\d+)" data-stock="(\d+)"/)![1];
  let stockBefore = parseStock(productHtml, skuId);

  if (stockBefore < 1) {
    const toppedUp = await topUpStock(skuId, 5);
    if (!toppedUp) {
      console.log(
        "[idempotency.test] SKU already drained by a previous run and ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping sequential idempotency check",
      );
      return;
    }
    productHtml = await (await jarGet(jar, new URL("/products/classic-tee", baseUrl))).text();
    stockBefore = parseStock(productHtml, skuId);
  }

  const checkoutHtml = await (
    await jarGet(jar, new URL(`/checkout?sku=${skuId}&qty=1`, baseUrl))
  ).text();
  const csrf = extractCsrf(checkoutHtml);
  const idempotencyKey = randomUUID();

  const first = await jarPostForm(jar, new URL("/buy", baseUrl), {
    _csrf: csrf,
    idempotency_key: idempotencyKey,
    sku_id: skuId,
    qty: "1",
  });
  expect(first.status).toBe(302);
  const firstLocation = first.headers.get("location");

  const second = await jarPostForm(jar, new URL("/buy", baseUrl), {
    _csrf: csrf,
    idempotency_key: idempotencyKey,
    sku_id: skuId,
    qty: "1",
  });
  expect(second.status).toBe(302);
  const secondLocation = second.headers.get("location");

  expect(secondLocation).toBe(firstLocation);

  const afterHtml = await (
    await jarGet(jar, new URL("/products/classic-tee", baseUrl))
  ).text();
  const stockAfter = parseStock(afterHtml, skuId);
  // Stock should have dropped by exactly 1 (one order), not 2.
  expect(stockAfter).toBe(stockBefore - 1);
});

it("submitting the same idempotency key in parallel creates exactly one order", async () => {
  const { jar } = await registerAndLogin(baseUrl);
  let productHtml = await (await jarGet(jar, new URL("/products/classic-tee", baseUrl))).text();
  let skus = [...productHtml.matchAll(/option value="(\d+)" data-stock="(\d+)"/g)];
  // Prefer whichever SKU currently has stock; fall back to the second option
  // (different from the sequential test above) if all show stock.
  let picked = skus.find((s) => Number(s[2]) > 0) ?? skus[1] ?? skus[0];
  let skuId = picked[1];
  let stockBefore = parseStock(productHtml, skuId);

  if (stockBefore < 1) {
    const toppedUp = await topUpStock(skuId, 5);
    if (!toppedUp) {
      console.log(
        "[idempotency.test] SKU already drained by a previous run and ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping parallel idempotency check",
      );
      return;
    }
    productHtml = await (await jarGet(jar, new URL("/products/classic-tee", baseUrl))).text();
    skus = [...productHtml.matchAll(/option value="(\d+)" data-stock="(\d+)"/g)];
    picked = skus.find((s) => s[1] === skuId)!;
    skuId = picked[1];
    stockBefore = parseStock(productHtml, skuId);
  }

  const checkoutHtml = await (
    await jarGet(jar, new URL(`/checkout?sku=${skuId}&qty=1`, baseUrl))
  ).text();
  const csrf = extractCsrf(checkoutHtml);
  const idempotencyKey = randomUUID();

  const attempts = await Promise.all(
    Array.from({ length: 4 }, () =>
      jarPostForm(jar, new URL("/buy", baseUrl), {
        _csrf: csrf,
        idempotency_key: idempotencyKey,
        sku_id: skuId,
        qty: "1",
      }),
    ),
  );

  for (const res of attempts) {
    expect(res.status).toBe(302);
  }
  const locations = new Set(attempts.map((r) => r.headers.get("location")));
  expect(locations.size).toBe(1);

  const afterHtml = await (
    await jarGet(jar, new URL("/products/classic-tee", baseUrl))
  ).text();
  const stockAfter = parseStock(afterHtml, skuId);
  expect(stockAfter).toBe(stockBefore - 1);
});
