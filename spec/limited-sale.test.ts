import { randomUUID } from "node:crypto";
import { expect, inject, it } from "vitest";
import { CookieJar, extractCsrf, jarGet, jarPostForm, registerAndLogin } from "./test-helpers.ts";

const baseUrl = inject("baseUrl");

// This DB persists across repeated local runs (redeploys never reset
// stock), so a limited SKU this test bought from on a previous run may have
// too little stock left to cover `limit` fresh purchases. If admin creds are
// available, top it back up; otherwise the caller skips gracefully.
async function topUpStock(
  productName: string,
  skuId: string,
  desired: number,
): Promise<boolean> {
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
  const row = productsHtml.split("<tr>").find((r) => r.includes(productName));
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

it("a limited product with release_at in the future cannot be bought yet", async () => {
  const { jar } = await registerAndLogin(baseUrl);
  const productHtml = await (
    await jarGet(jar, new URL("/products/drop-puffer", baseUrl))
  ).text();
  expect(productHtml).toMatch(/not available for purchase yet/i);

  const skuId = productHtml.match(/option value="(\d+)" data-stock="(\d+)"/)![1];

  const checkoutRes = await jarGet(jar, new URL(`/checkout?sku=${skuId}&qty=1`, baseUrl));
  // Whether checkout itself blocks or not, /buy must be the final authority.
  if (checkoutRes.status === 200) {
    const checkoutHtml = await checkoutRes.text();
    const csrf = extractCsrf(checkoutHtml);
    const idempotencyKey =
      checkoutHtml.match(/name="idempotency_key" value="([^"]*)"/)?.[1] ?? randomUUID();
    const buyRes = await jarPostForm(jar, new URL("/buy", baseUrl), {
      _csrf: csrf,
      idempotency_key: idempotencyKey,
      sku_id: skuId,
      qty: "1",
    });
    expect(buyRes.status).not.toBe(302);
    const body = await buyRes.text();
    expect(body).toMatch(/not live|not available|release/i);
  } else {
    expect(checkoutRes.status).not.toBe(200);
  }
});

it("per-account purchase limit is enforced across multiple orders and isn't bypassable by claiming a different role/price", async () => {
  const { jar } = await registerAndLogin(baseUrl);
  const productHtml = await (
    await jarGet(jar, new URL("/products/drop-hitops", baseUrl))
  ).text();
  expect(productHtml).toMatch(/Available now/i);
  const limitMatch = productHtml.match(/Limit (\d+) per account/);
  expect(limitMatch).not.toBeNull();
  const limit = Number(limitMatch![1]);

  const skuMatch = productHtml.match(/option value="(\d+)" data-stock="(\d+)"/)!;
  const skuId = skuMatch[1];
  const stock = Number(skuMatch[2]);

  if (stock < limit) {
    const toppedUp = await topUpStock("Drop Hi-Tops", skuId, limit + 2);
    if (!toppedUp) {
      console.log(
        "[limited-sale.test] SKU too depleted by a previous run and ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping per-account-limit check",
      );
      return;
    }
  }

  async function attemptBuy(qty: number): Promise<Response> {
    const checkoutHtml = await (
      await jarGet(jar, new URL(`/checkout?sku=${skuId}&qty=${qty}`, baseUrl))
    ).text();
    const csrf = extractCsrf(checkoutHtml);
    const idempotencyKey =
      checkoutHtml.match(/name="idempotency_key" value="([^"]*)"/)?.[1] ?? randomUUID();
    return jarPostForm(jar, new URL("/buy", baseUrl), {
      _csrf: csrf,
      idempotency_key: idempotencyKey,
      sku_id: skuId,
      qty: String(qty),
      // Smuggled fields: must not let this order bypass the per-account
      // limit or change its recorded price.
      role: "admin",
      price_cents: "1",
      per_account_limit: "999",
    });
  }

  // Place orders one unit at a time up to the limit — all must succeed.
  for (let i = 0; i < limit; i++) {
    const res = await attemptBuy(1);
    expect(res.status).toBe(302);
  }

  // The next purchase, even for 1 more unit, must be rejected.
  const overLimitRes = await attemptBuy(1);
  expect(overLimitRes.status).not.toBe(302);
  const body = await overLimitRes.text();
  expect(body).toMatch(/limit/i);
});
