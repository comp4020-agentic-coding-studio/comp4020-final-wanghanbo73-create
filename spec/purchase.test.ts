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
// so a SKU this test bought from on a previous run may already sit at 0. If
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

it("full purchase flow: register, login, buy, view order with server-computed total", async () => {
  const { jar } = await registerAndLogin(baseUrl);

  const productPage = await jarGet(jar, new URL("/products/canvas-hoodie", baseUrl));
  expect(productPage.status).toBe(200);
  let productHtml = await productPage.text();
  const priceMatch = productHtml.match(/product-detail__price">\$([0-9.]+)/);
  expect(priceMatch).not.toBeNull();
  const unitPrice = Number(priceMatch![1]);

  const qty = 2;
  let skus = [...productHtml.matchAll(/option value="(\d+)" data-stock="(\d+)"/g)];
  let picked = skus.find((s) => Number(s[2]) >= qty);
  if (!picked) {
    const fallback = skus[0];
    expect(fallback, "expected a SKU on canvas-hoodie").not.toBeUndefined();
    const toppedUp = await topUpStock("Canvas Hoodie", fallback![1], qty + 3);
    expect(toppedUp, "canvas-hoodie SKU is drained and ADMIN_EMAIL/ADMIN_PASSWORD aren't set to top it up").toBe(true);
    productHtml = await (
      await jarGet(jar, new URL("/products/canvas-hoodie", baseUrl))
    ).text();
    skus = [...productHtml.matchAll(/option value="(\d+)" data-stock="(\d+)"/g)];
    picked = skus.find((s) => s[1] === fallback![1]);
  }
  const skuId = picked![1];

  const checkoutRes = await jarGet(jar, new URL(`/checkout?sku=${skuId}&qty=${qty}`, baseUrl));
  expect(checkoutRes.status).toBe(200);
  const checkoutHtml = await checkoutRes.text();
  expect(checkoutHtml).toMatch(/simulated checkout, no real charge/i);

  const csrf = extractCsrf(checkoutHtml);
  const idempotencyKey = checkoutHtml.match(/name="idempotency_key" value="([^"]*)"/)![1];

  const buyRes = await jarPostForm(jar, new URL("/buy", baseUrl), {
    _csrf: csrf,
    idempotency_key: idempotencyKey,
    sku_id: skuId,
    qty: String(qty),
  });
  expect(buyRes.status).toBe(302);
  const orderLocation = buyRes.headers.get("location")!;

  const orderRes = await jarGet(jar, new URL(orderLocation, baseUrl));
  expect(orderRes.status).toBe(200);
  const orderHtml = await orderRes.text();

  const expectedTotal = (unitPrice * qty).toFixed(2);
  expect(orderHtml).toContain(`$${expectedTotal}`);
});

it("a submitted (fake) unit price in the request body is never trusted", async () => {
  const { jar } = await registerAndLogin(baseUrl);
  let productPage = await jarGet(jar, new URL("/products/classic-tee", baseUrl));
  let html = await productPage.text();
  let skus = [...html.matchAll(/option value="(\d+)" data-stock="(\d+)"/g)];
  let picked = skus.find((s) => Number(s[2]) > 0);
  if (!picked) {
    const fallback = skus[0];
    expect(fallback, "expected at least one SKU option on classic-tee").not.toBeUndefined();
    const toppedUp = await topUpStock("Classic Tee", fallback![1], 5);
    expect(toppedUp, "classic-tee is drained and admin top-up failed").toBe(true);
    productPage = await jarGet(jar, new URL("/products/classic-tee", baseUrl));
    html = await productPage.text();
    skus = [...html.matchAll(/option value="(\d+)" data-stock="(\d+)"/g)];
    picked = skus.find((s) => s[1] === fallback![1]);
  }
  const skuId = picked![1];

  const checkoutRes = await jarGet(jar, new URL(`/checkout?sku=${skuId}&qty=1`, baseUrl));
  const checkoutHtml = await checkoutRes.text();
  const csrf = extractCsrf(checkoutHtml);
  const idempotencyKey = checkoutHtml.match(/name="idempotency_key" value="([^"]*)"/)![1];

  const buyRes = await jarPostForm(jar, new URL("/buy", baseUrl), {
    _csrf: csrf,
    idempotency_key: idempotencyKey,
    sku_id: skuId,
    qty: "1",
    // Attempt to smuggle a near-zero price; the server must ignore this.
    unit_price_cents: "1",
    price_cents: "1",
  });
  expect(buyRes.status).toBe(302);
  const orderLocation = buyRes.headers.get("location")!;
  const orderRes = await jarGet(jar, new URL(orderLocation, baseUrl));
  const orderHtml = await orderRes.text();
  // Classic Tee is seeded at $25.00; a smuggled price of $0.01 must not appear.
  expect(orderHtml).toContain("$25.00");
  expect(orderHtml).not.toContain("$0.01");
});

it("a later admin price change doesn't affect an already-placed order's snapshot", async () => {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    console.log(
      "[purchase.test] ADMIN_EMAIL/ADMIN_PASSWORD not set in test env — skipping price-snapshot sub-assertion",
    );
    return;
  }

  const { jar } = await registerAndLogin(baseUrl);
  let productPage = await jarGet(jar, new URL("/products/relaxed-chinos", baseUrl));
  let html = await productPage.text();
  let skus = [...html.matchAll(/option value="(\d+)" data-stock="(\d+)"/g)];
  let picked = skus.find((s) => Number(s[2]) > 0);
  if (!picked) {
    const fallback = skus[0];
    expect(fallback, "expected at least one SKU option on relaxed-chinos").not.toBeUndefined();
    const toppedUp = await topUpStock("Relaxed Chinos", fallback![1], 5);
    expect(toppedUp, "relaxed-chinos is drained and admin top-up failed").toBe(true);
    productPage = await jarGet(jar, new URL("/products/relaxed-chinos", baseUrl));
    html = await productPage.text();
    skus = [...html.matchAll(/option value="(\d+)" data-stock="(\d+)"/g)];
    picked = skus.find((s) => s[1] === fallback![1]);
  }
  const skuId = picked![1];

  const checkoutRes = await jarGet(jar, new URL(`/checkout?sku=${skuId}&qty=1`, baseUrl));
  const checkoutHtml = await checkoutRes.text();
  const csrf = extractCsrf(checkoutHtml);
  const idempotencyKey = checkoutHtml.match(/name="idempotency_key" value="([^"]*)"/)![1];

  const buyRes = await jarPostForm(jar, new URL("/buy", baseUrl), {
    _csrf: csrf,
    idempotency_key: idempotencyKey,
    sku_id: skuId,
    qty: "1",
  });
  const orderLocation = buyRes.headers.get("location")!;
  const orderResBefore = await jarGet(jar, new URL(orderLocation, baseUrl));
  const orderHtmlBefore = await orderResBefore.text();
  const totalBefore = orderHtmlBefore.match(/Total<\/td><td><strong>\$([0-9.]+)/)![1];

  // Log in as admin and bump the price.
  const adminJar = new CookieJar();
  const loginPage = await jarGet(adminJar, new URL("/login", baseUrl));
  const loginCsrf = extractCsrf(await loginPage.text());
  await jarPostForm(adminJar, new URL("/login", baseUrl), {
    email: adminEmail,
    password: adminPassword,
    _csrf: loginCsrf,
  });

  const productsRes = await jarGet(adminJar, new URL("/admin/products", baseUrl));
  const productsHtml = await productsRes.text();
  // Find product id for relaxed-chinos by scanning edit links near its name.
  const rows = productsHtml.split("<tr>").filter((r) => r.includes("Relaxed Chinos"));
  expect(rows.length).toBeGreaterThan(0);
  const idMatch = rows[0].match(/\/admin\/products\/(\d+)\/edit/);
  expect(idMatch).not.toBeNull();
  const productId = idMatch![1];

  const editPage = await jarGet(adminJar, new URL(`/admin/products/${productId}/edit`, baseUrl));
  const editHtml = await editPage.text();
  const editCsrf = extractCsrf(editHtml);

  await jarPostForm(adminJar, new URL(`/admin/products/${productId}/edit`, baseUrl), {
    _csrf: editCsrf,
    name: "Relaxed Chinos",
    slug: "relaxed-chinos",
    description: "Everyday chinos with a tapered leg.",
    price_cents: "999999",
    category: "clothing",
    sale_type: "regular",
    active: "1",
    release_at: "",
    per_account_limit: "",
    image_path: "/images/relaxed-chinos.svg",
  });

  const orderResAfter = await jarGet(jar, new URL(orderLocation, baseUrl));
  const orderHtmlAfter = await orderResAfter.text();
  const totalAfter = orderHtmlAfter.match(/Total<\/td><td><strong>\$([0-9.]+)/)![1];

  expect(totalAfter).toBe(totalBefore);
});
