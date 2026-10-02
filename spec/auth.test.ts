import { expect, inject, it } from "vitest";
import { CookieJar, extractCsrf, jarGet, jarPostForm } from "./test-helpers.ts";

const baseUrl = inject("baseUrl");

it("registering with a posted role=admin field still yields a customer account", async () => {
  const jar = new CookieJar();
  const email = `role-test-${Date.now()}@example.com`;

  const regPage = await jarGet(jar, new URL("/register", baseUrl));
  const csrf = extractCsrf(await regPage.text());

  const res = await jarPostForm(jar, new URL("/register", baseUrl), {
    email,
    password: "password123!",
    role: "admin",
    _csrf: csrf,
  });
  expect(res.status).toBe(302);

  // The only way to tell from the outside: this account must NOT be able to
  // reach admin-only pages.
  const adminRes = await jarGet(jar, new URL("/admin", baseUrl));
  expect([302, 403]).toContain(adminRes.status);
  if (adminRes.status === 302) {
    expect(adminRes.headers.get("location")).not.toBe("/admin");
  }
});

it("has no public route that creates an admin account", async () => {
  // No /admin/register or similar should exist; hitting it must not succeed.
  const res = await fetch(new URL("/admin/register", baseUrl), { redirect: "manual" });
  expect(res.status).not.toBe(200);
});
