import { randomUUID } from "node:crypto";
import { expect, inject, it } from "vitest";
import { CookieJar, extractCsrf, jarGet, jarPostForm, registerAndLogin } from "./test-helpers.ts";

const baseUrl = inject("baseUrl");

// A limited-drop-specific concurrency scenario, complementing
// spec/inventory.test.ts's generic last-unit race: this fires concurrent
// buyers at a *live limited release* (drop-hitops), checking both the
// no-oversell guarantee and the per-account limit hold under a real race —
// the two invariants a brand owner watching a drop demo would actually ask
// about ("can it be oversold?" and "can one person grab everyone else's
// allocation by hammering refresh?").

async function adminLogin(): Promise<CookieJar | null> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) return null;
  const jar = new CookieJar();
  const loginPage = await jarGet(jar, new URL("/login", baseUrl));
  const csrf = extractCsrf(await loginPage.text());
  const res = await jarPostForm(jar, new URL("/login", baseUrl), {
    email: adminEmail,
    password: adminPassword,
    _csrf: csrf,
  });
  return res.status === 302 ? jar : null;
}

async function restock(jar: CookieJar, skuId: string, stock: number): Promise<boolean> {
  const productsHtml = await (await jarGet(jar, new URL("/admin/products", baseUrl))).text();
  const row = productsHtml.split("<tr>").find((r) => r.includes("Drop Hi-Tops"));
  const productId = row?.match(/\/admin\/products\/(\d+)\/edit/)?.[1];
  if (!productId) return false;
  const editPage = await jarGet(jar, new URL(`/admin/products/${productId}/edit`, baseUrl));
  const csrf = extractCsrf(await editPage.text());
  const res = await jarPostForm(jar, new URL(`/admin/products/${productId}/edit`, baseUrl), {
    _csrf: csrf,
    update_sku_id: skuId,
    stock: String(stock),
  });
  return res.status === 302;
}

interface SkuOption {
  id: string;
  stock: number;
}

function parseSkus(html: string): SkuOption[] {
  const out: SkuOption[] = [];
  const re = /<option value="(\d+)" data-stock="(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push({ id: m[1], stock: Number(m[2]) });
  return out;
}

async function buy(jar: CookieJar, skuId: string, qty = 1): Promise<Response> {
  const checkoutRes = await jarGet(jar, new URL(`/checkout?sku=${skuId}&qty=${qty}`, baseUrl));
  if (checkoutRes.status !== 200) return checkoutRes;
  const html = await checkoutRes.text();
  const csrf = extractCsrf(html);
  const idempotencyKey = html.match(/name="idempotency_key" value="([^"]*)"/)?.[1] ?? randomUUID();
  return jarPostForm(jar, new URL("/buy", baseUrl), {
    _csrf: csrf,
    idempotency_key: idempotencyKey,
    sku_id: skuId,
    qty: String(qty),
  });
}

it("a live drop cannot be oversold under concurrent different-account buyers", async () => {
  const setupJar = (await registerAndLogin(baseUrl)).jar;
  const html = await (await jarGet(setupJar, new URL("/products/drop-hitops", baseUrl))).text();
  const skus = parseSkus(html);
  expect(skus.length).toBeGreaterThan(0);
  const target = skus[0];

  const admin = await adminLogin();
  if (!admin) {
    console.log(
      "[limited-drop-rush.test] ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping oversell-under-concurrency check",
    );
    return;
  }
  expect(await restock(admin, target.id, 2)).toBe(true);

  const buyers = await Promise.all(Array.from({ length: 6 }, () => registerAndLogin(baseUrl)));
  const results = await Promise.all(buyers.map(({ jar }) => buy(jar, target.id, 1)));
  const succeeded = results.filter((r) => r.status === 302);
  const failed = results.filter((r) => r.status !== 302);

  expect(succeeded.length).toBe(2);
  expect(failed.length).toBe(results.length - 2);
  for (const res of failed) {
    const body = await res.text();
    expect(body).toMatch(/stock|left|available/i);
  }

  const finalHtml = await (await jarGet(setupJar, new URL("/products/drop-hitops", baseUrl))).text();
  const finalStock = parseSkus(finalHtml).find((s) => s.id === target.id)!.stock;
  expect(finalStock).toBe(0);
});

it("per-account limit holds when the same account fires concurrent requests", async () => {
  const setupJar = (await registerAndLogin(baseUrl)).jar;
  const html = await (await jarGet(setupJar, new URL("/products/drop-hitops", baseUrl))).text();
  const skus = parseSkus(html);
  const target = skus[0];
  const limitMatch = html.match(/Limit (\d+) per account/);
  expect(limitMatch).not.toBeNull();
  const limit = Number(limitMatch![1]);

  const admin = await adminLogin();
  if (!admin) {
    console.log(
      "[limited-drop-rush.test] ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping per-account-limit-under-concurrency check",
    );
    return;
  }
  // Stock is deliberately well above the limit so stock is never the binding
  // constraint here — only the per-account limit should cap this account.
  expect(await restock(admin, target.id, limit + 5)).toBe(true);

  const { jar } = await registerAndLogin(baseUrl);
  const attempts = limit + 3;
  const results = await Promise.all(Array.from({ length: attempts }, () => buy(jar, target.id, 1)));
  const succeeded = results.filter((r) => r.status === 302);
  const failed = results.filter((r) => r.status !== 302);

  expect(succeeded.length).toBe(limit);
  expect(failed.length).toBe(attempts - limit);
  for (const res of failed) {
    const body = await res.text();
    expect(body).toMatch(/limit/i);
  }
});
