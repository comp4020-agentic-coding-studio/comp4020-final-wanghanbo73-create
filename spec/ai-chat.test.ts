import { expect, inject, it } from "vitest";
import { extractCsrf, jarGet, jarFetch, registerAndLogin } from "./test-helpers.ts";

const baseUrl = inject("baseUrl");

it("an anonymous visitor does not see the AI chat widget on any page", async () => {
  const res = await fetch(new URL("/", baseUrl));
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).not.toContain("ai-chat-toggle");
  expect(html).not.toContain("ai-chat-widget.js");
});

it("a logged-in customer sees the AI chat widget on a normal page", async () => {
  const { jar } = await registerAndLogin(baseUrl);
  const res = await jarGet(jar, new URL("/", baseUrl));
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('id="ai-chat-toggle"');
  expect(html).toContain('id="ai-chat-panel"');
  expect(html).toContain("ai-chat-form");
  expect(html).toContain('id="ai-chat-input"');
  expect(html).toContain("ai-chat-widget.js");
});

it("posting to /ai-chat/stream without a session is rejected, not 500", async () => {
  const res = await fetch(new URL("/ai-chat/stream", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "hi", history: [] }),
    redirect: "manual",
  });
  expect(res.status).not.toBe(500);
  expect([302, 401, 403]).toContain(res.status);
});

it("a logged-in customer's chat request either streams a reply or fails gracefully, never 500", async () => {
  const { jar } = await registerAndLogin(baseUrl);
  const page = await jarGet(jar, new URL("/", baseUrl));
  const pageHtml = await page.text();
  const csrf = extractCsrf(pageHtml);

  const res = await jarFetch(jar, new URL("/ai-chat/stream", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "What's in stock?", history: [], _csrf: csrf }),
    redirect: "manual",
  });

  // Whether or not ANTHROPIC_API_KEY is configured for this run, the route
  // must never 500 — either it streams a real/graceful-unavailable reply.
  expect(res.status).not.toBe(500);
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body.length).toBeGreaterThan(0);
});
