import { expect, inject, it } from "vitest";
import {
  CookieJar,
  extractCsrf,
  jarGet,
  jarPostForm,
  registerAndLogin,
} from "./test-helpers.ts";

const baseUrl = inject("baseUrl");

// This DB persists across repeated local runs (redeploys never reset stock),
// so a SKU this test buys from on a previous run may already sit at 0. If
// admin creds are available, top it back up; otherwise return false.
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

it("a logged-in customer hitting /admin is rejected, not shown admin content", async () => {
  const { jar } = await registerAndLogin(baseUrl);
  const res = await jarGet(jar, new URL("/admin", baseUrl));
  expect(res.status).not.toBe(200);
  expect([302, 403]).toContain(res.status);
});

it("a logged-in customer hitting /admin/orders is rejected", async () => {
  const { jar } = await registerAndLogin(baseUrl);
  const res = await jarGet(jar, new URL("/admin/orders", baseUrl));
  expect(res.status).not.toBe(200);
  expect([302, 403]).toContain(res.status);
});

it("direct POST to an admin action without admin session is rejected", async () => {
  const { jar } = await registerAndLogin(baseUrl);
  // Get a real CSRF token (from a page the customer CAN see) so this checks
  // the role guard specifically, not just CSRF rejection.
  const home = await jarGet(jar, new URL("/", baseUrl));
  const csrf = extractCsrf(await home.text());
  const res = await jarPostForm(jar, new URL("/admin/orders/1/status", baseUrl), {
    status: "completed",
    _csrf: csrf,
  });
  expect(res.status).not.toBe(200);
  expect([302, 403]).toContain(res.status);
});

it("a customer cannot view another customer's order", async () => {
  const buyer = await registerAndLogin(baseUrl);
  let productPage = await jarGet(buyer.jar, new URL("/products/classic-tee", baseUrl));
  let html = await productPage.text();
  let skus = [...html.matchAll(/option value="(\d+)" data-stock="(\d+)"/g)];
  let picked = skus.find((s) => Number(s[2]) > 0);
  if (!picked) {
    const fallback = skus[0];
    expect(fallback, "expected at least one SKU option on classic-tee").not.toBeUndefined();
    const toppedUp = await topUpStock("Classic Tee", fallback![1], 5);
    expect(
      toppedUp,
      "classic-tee is drained and ADMIN_EMAIL/ADMIN_PASSWORD aren't set to top it up",
    ).toBe(true);
    productPage = await jarGet(buyer.jar, new URL("/products/classic-tee", baseUrl));
    html = await productPage.text();
    skus = [...html.matchAll(/option value="(\d+)" data-stock="(\d+)"/g)];
    picked = skus.find((s) => s[1] === fallback![1]);
  }
  const skuId = picked![1];

  const checkoutPage = await jarGet(
    buyer.jar,
    new URL(`/checkout?sku=${skuId}&qty=1`, baseUrl),
  );
  const checkoutHtml = await checkoutPage.text();
  const csrf = extractCsrf(checkoutHtml);
  const idemMatch = checkoutHtml.match(/name="idempotency_key" value="([^"]*)"/);
  const idempotencyKey = idemMatch![1];

  const buyRes = await jarPostForm(buyer.jar, new URL("/buy", baseUrl), {
    _csrf: csrf,
    idempotency_key: idempotencyKey,
    sku_id: skuId,
    qty: "1",
  });
  expect(buyRes.status).toBe(302);
  const orderLocation = buyRes.headers.get("location")!;
  expect(orderLocation).toMatch(/^\/orders\/\d+$/);

  // Own order: visible.
  const ownRes = await jarGet(buyer.jar, new URL(orderLocation, baseUrl));
  expect(ownRes.status).toBe(200);

  // A different customer must not be able to view it.
  const stranger = await registerAndLogin(baseUrl);
  const strangerRes = await jarGet(stranger.jar, new URL(orderLocation, baseUrl));
  expect([403, 404]).toContain(strangerRes.status);
});
