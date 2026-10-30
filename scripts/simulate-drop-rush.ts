#!/usr/bin/env node
// A literal "watch it not oversell" artifact to run live in front of a
// tutor or a brand owner — separate from the automated assertions in
// spec/limited-drop-rush.test.ts, but driven by the same real HTTP flow
// (register, checkout, buy) against a real running instance.
//
// Usage:
//   APP_URL=http://localhost:8080 ADMIN_EMAIL=... ADMIN_PASSWORD=... \
//     node scripts/simulate-drop-rush.ts [slug] [buyers] [restock]
//
// Defaults to the seeded "drop-hitops" limited release, 12 concurrent
// buyers, and restocking its first SKU to 3 units before the rush so the
// scarcity is visible and reproducible run to run.
import { randomUUID } from "node:crypto";
import {
  CookieJar,
  extractCsrf,
  jarGet,
  jarPostForm,
  registerAndLogin,
} from "../spec/test-helpers.ts";

const baseUrl = process.env.APP_URL ?? "http://localhost:8080";
const slug = process.argv[2] ?? "drop-hitops";
const buyerCount = Number(process.argv[3]) || 12;
const restockTo = Number(process.argv[4]) || 3;

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

async function restock(jar: CookieJar, productName: string, skuId: string, stock: number): Promise<void> {
  const productsHtml = await (await jarGet(jar, new URL("/admin/products", baseUrl))).text();
  const row = productsHtml.split("<tr>").find((r) => r.includes(productName));
  const productId = row?.match(/\/admin\/products\/(\d+)\/edit/)?.[1];
  if (!productId) throw new Error(`could not find admin edit link for "${productName}"`);
  const editPage = await jarGet(jar, new URL(`/admin/products/${productId}/edit`, baseUrl));
  const csrf = extractCsrf(await editPage.text());
  await jarPostForm(jar, new URL(`/admin/products/${productId}/edit`, baseUrl), {
    _csrf: csrf,
    update_sku_id: skuId,
    stock: String(stock),
  });
}

async function buy(jar: CookieJar, skuId: string): Promise<{ ok: boolean; message: string }> {
  const checkoutRes = await jarGet(jar, new URL(`/checkout?sku=${skuId}&qty=1`, baseUrl));
  if (checkoutRes.status !== 200) return { ok: false, message: `checkout ${checkoutRes.status}` };
  const html = await checkoutRes.text();
  const csrf = extractCsrf(html);
  const idempotencyKey = html.match(/name="idempotency_key" value="([^"]*)"/)?.[1] ?? randomUUID();
  const res = await jarPostForm(jar, new URL("/buy", baseUrl), {
    _csrf: csrf,
    idempotency_key: idempotencyKey,
    sku_id: skuId,
    qty: "1",
  });
  if (res.status === 302) return { ok: true, message: "order placed" };
  const body = await res.text();
  const match = body.match(/notice--error[^>]*>([^<]*)</);
  return { ok: false, message: match?.[1]?.trim() ?? `rejected (${res.status})` };
}

async function main(): Promise<void> {
  console.log(`Fieldmark drop rush simulator — ${baseUrl}`);
  console.log(`Target: ${slug}, ${buyerCount} concurrent buyers`);
  console.log("");

  const setupJar = (await registerAndLogin(baseUrl)).jar;
  let html = await (await jarGet(setupJar, new URL(`/products/${slug}`, baseUrl))).text();
  let skus = parseSkus(html);
  if (!skus.length) throw new Error(`no SKUs found for ${slug} — is it seeded and live?`);
  const target = skus[0];
  const productName = html.match(/data-product-name>([^<]*)</)?.[1]?.trim() ?? slug;

  const admin = await adminLogin();
  if (admin) {
    console.log(`Restocking ${slug} (${target.color}/${target.size}) to ${restockTo} units...`);
    await restock(admin, productName, target.id, restockTo);
    html = await (await jarGet(setupJar, new URL(`/products/${slug}`, baseUrl))).text();
    skus = parseSkus(html);
  } else {
    console.log("ADMIN_EMAIL/ADMIN_PASSWORD not set — using current stock as-is, no restock.");
  }
  const before = skus.find((s) => s.id === target.id)!;
  console.log(`Starting stock: ${before.stock} units of ${before.color}/${before.size}`);
  console.log("");
  console.log(`Firing ${buyerCount} concurrent buyers at the same SKU...`);

  const buyers = await Promise.all(
    Array.from({ length: buyerCount }, () => registerAndLogin(baseUrl)),
  );
  const started = Date.now();
  const results = await Promise.all(buyers.map(({ jar }) => buy(jar, target.id)));
  const elapsedMs = Date.now() - started;

  const succeeded = results.filter((r) => r.ok);
  const rejected = results.filter((r) => !r.ok);

  console.log("");
  console.log(`Done in ${elapsedMs}ms.`);
  console.log(`  Orders placed: ${succeeded.length}`);
  console.log(`  Rejected:      ${rejected.length}`);
  for (const r of rejected) console.log(`    - ${r.message}`);

  const finalHtml = await (await jarGet(setupJar, new URL(`/products/${slug}`, baseUrl))).text();
  const finalStock = parseSkus(finalHtml).find((s) => s.id === target.id)!.stock;
  console.log("");
  console.log(`Final stock: ${finalStock} (expected ${Math.max(before.stock - succeeded.length, 0)})`);
  if (succeeded.length > before.stock) {
    console.log("OVERSOLD — this should never happen. Investigate the checkout transaction.");
    process.exitCode = 1;
  } else {
    console.log("No oversell: successful orders never exceeded available stock.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
