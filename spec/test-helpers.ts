// Small cookie-jar fetch helper so spec/*.test.ts can carry a session across
// requests against the real running app (no server started from in-process —
// spec/global-setup.ts already found one and handed us its baseUrl).
import { randomUUID } from "node:crypto";

export class CookieJar {
  #cookies = new Map<string, string>();

  absorb(res: Response): void {
    // undici/Node's fetch exposes multiple Set-Cookie headers via getSetCookie()
    const setCookies =
      typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const raw of setCookies) {
      const [pair] = raw.split(";");
      const idx = pair.indexOf("=");
      if (idx === -1) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      this.#cookies.set(name, value);
    }
  }

  header(): string {
    return [...this.#cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

export interface JarFetchInit extends Omit<RequestInit, "redirect"> {
  redirect?: "manual" | "follow" | "error";
}

export async function jarFetch(
  jar: CookieJar,
  url: string | URL,
  init: JarFetchInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const cookieHeader = jar.header();
  if (cookieHeader) headers.set("cookie", cookieHeader);
  const res = await fetch(url, { ...init, headers, redirect: init.redirect ?? "manual" });
  jar.absorb(res);
  return res;
}

export async function jarGet(jar: CookieJar, url: string | URL): Promise<Response> {
  return jarFetch(jar, url, { redirect: "manual" });
}

export async function jarPostForm(
  jar: CookieJar,
  url: string | URL,
  fields: Record<string, string>,
): Promise<Response> {
  return jarFetch(jar, url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual",
  });
}

// Pulls the hidden `_csrf` input's value out of a rendered form page.
export function extractCsrf(html: string): string {
  const match = html.match(/name="_csrf" value="([^"]*)"/);
  if (!match) throw new Error("no _csrf hidden input found in page");
  return match[1];
}

export interface RegisteredCustomer {
  jar: CookieJar;
  email: string;
  password: string;
}

// Registers a fresh customer account and logs in (register already logs in,
// but this keeps callers from caring about that detail), returning a jar
// with an authenticated session.
export async function registerAndLogin(baseUrl: string): Promise<RegisteredCustomer> {
  const email = `customer-${randomUUID()}@example.com`;
  const password = "password123!";
  const jar = new CookieJar();

  const regPage = await jarGet(jar, new URL("/register", baseUrl));
  const csrf = extractCsrf(await regPage.text());

  const res = await jarPostForm(jar, new URL("/register", baseUrl), {
    email,
    password,
    _csrf: csrf,
  });
  if (res.status !== 302) {
    throw new Error(`register failed: ${res.status} ${await res.text()}`);
  }

  return { jar, email, password };
}

// Follows redirects manually up to a limit, returning the final response.
// Useful when a flow issues several 302s in a row (e.g. buy -> order page).
export async function followRedirects(
  jar: CookieJar,
  res: Response,
  baseUrl: string,
  max = 5,
): Promise<Response> {
  let current = res;
  let hops = 0;
  while (current.status >= 300 && current.status < 400 && hops < max) {
    const location = current.headers.get("location");
    if (!location) break;
    current = await jarGet(jar, new URL(location, baseUrl));
    hops++;
  }
  return current;
}
