import { randomUUID } from "node:crypto";
import { expect, inject, it } from "vitest";
import { CookieJar, extractCsrf, jarGet, jarPostForm, registerAndLogin } from "./test-helpers.ts";

const baseUrl = inject("baseUrl");

// This DB persists across repeated local runs (by design — redeploys never
// reset stock), so a SKU this test drained on a previous run may already sit
// at 0. If admin creds are available, top it back up to a known value so the
// race is reproducible; otherwise the test skips with a note rather than
// fail on stale state left over from an earlier run.
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

  const productsHtml = await (
    await jarGet(jar, new URL("/admin/products", baseUrl))
  ).text();
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

interface SkuOption {
  id: string;
  color: string;
  size: string;
  stock: number;
}

function parseSkus(html: string): SkuOption[] {
  const out: SkuOption[] = [];
  const re = /<option value="(\d+)" data-stock="(\d+)"[^>]*>\s*([^/]+?)\s*\/\s*([^—]+?)\s*—/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    out.push({ id: m[1], stock: Number(m[2]), color: m[3].trim(), size: m[4].trim() });
  }
  return out;
}

async function buy(
  jar: Awaited<ReturnType<typeof registerAndLogin>>["jar"],
  skuId: string,
  qty: number,
): Promise<Response> {
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

it("buying one SKU does not reduce another SKU's stock", async () => {
  const { jar } = await registerAndLogin(baseUrl);
  let before = parseSkus(await (await jarGet(jar, new URL("/products/court-classic", baseUrl))).text());
  expect(before.length).toBeGreaterThanOrEqual(2);

  let found = before.find((s) => s.stock > 0);
  if (!found) {
    const fallback = before[0];
    const toppedUp = await topUpStock("Court Classic", fallback.id, 5);
    expect(toppedUp, "court-classic is drained and admin top-up failed").toBe(true);
    before = parseSkus(await (await jarGet(jar, new URL("/products/court-classic", baseUrl))).text());
    found = before.find((s) => s.id === fallback.id);
  }
  expect(found).toBeDefined();
  const skuA = found!;
  const skuB = before.find((s) => s.id !== skuA.id)!;
  expect(skuB).toBeDefined();

  const res = await buy(jar, skuA.id, 1);
  expect(res.status).toBe(302);

  const after = parseSkus(await (await jarGet(jar, new URL("/products/court-classic", baseUrl))).text());
  const afterA = after.find((s) => s.id === skuA.id)!;
  const afterB = after.find((s) => s.id === skuB.id)!;

  expect(afterA.stock).toBe(skuA.stock - 1);
  expect(afterB.stock).toBe(skuB.stock);
});

it("concurrent purchases of the last unit: exactly one succeeds, no oversell", async () => {
  const { jar: setupJar } = await registerAndLogin(baseUrl);
  let html = await (await jarGet(setupJar, new URL("/products/trail-runner", baseUrl))).text();
  let skus = parseSkus(html);
  let target = skus.find((s) => s.color === "Red") ?? skus[skus.length - 1];
  expect(target).toBeDefined();

  if (target.stock < 2) {
    const toppedUp = await topUpStock("Trail Runner", target.id, 3);
    if (!toppedUp) {
      console.log(
        "[inventory.test] SKU already drained by a previous run and ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping concurrent-oversell check",
      );
      return;
    }
    html = await (await jarGet(setupJar, new URL("/products/trail-runner", baseUrl))).text();
    skus = parseSkus(html);
    target = skus.find((s) => s.id === target.id)!;
  }

  // Drain down to exactly 1 unit left using sequential purchases from the
  // setup account, so the race is deterministic at stock === 1.
  let remaining = target.stock;
  while (remaining > 1) {
    const take = Math.min(remaining - 1, remaining);
    const res = await buy(setupJar, target.id, take);
    expect(res.status).toBe(302);
    remaining -= take;
  }

  const confirmHtml = await (
    await jarGet(setupJar, new URL("/products/trail-runner", baseUrl))
  ).text();
  const confirmed = parseSkus(confirmHtml).find((s) => s.id === target.id)!;
  expect(confirmed.stock).toBe(1);

  // Now fire several concurrent buyers at the last unit.
  const buyers = await Promise.all([
    registerAndLogin(baseUrl),
    registerAndLogin(baseUrl),
    registerAndLogin(baseUrl),
  ]);

  const results = await Promise.all(buyers.map(({ jar }) => buy(jar, target.id, 1)));
  const succeeded = results.filter((r) => r.status === 302);
  const failed = results.filter((r) => r.status !== 302);

  expect(succeeded.length).toBe(1);
  expect(failed.length).toBe(results.length - 1);
  for (const res of failed) {
    const body = await res.text();
    expect(body).toMatch(/stock|left|available/i);
  }

  const finalHtml = await (
    await jarGet(setupJar, new URL("/products/trail-runner", baseUrl))
  ).text();
  const finalSku = parseSkus(finalHtml).find((s) => s.id === target.id)!;
  expect(finalSku.stock).toBe(0);
});
