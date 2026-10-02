import type { SessionUser } from "../types.ts";
import { escapeHtml, when } from "./html.ts";

export interface LayoutOptions {
  title: string;
  user?: SessionUser;
  csrfToken?: string;
  body: string;
}

export function layout({ title, user, csrfToken, body }: LayoutOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} — Fieldmark</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="site-header__inner">
      <a class="brand" href="/"><span class="brand__mark" aria-hidden="true">FM</span>Fieldmark</a>
      <nav aria-label="Main">
        <ul class="nav-list">
          <li><a href="/">Home</a></li>
          <li><a href="/limited">Limited</a></li>
          ${when(user, `<li><a href="/orders">My Orders</a></li>`)}
          ${when(user?.role === "admin", `<li><a href="/admin">Admin</a></li>`)}
          ${
            user
              ? `<li>
                  <form method="post" action="/logout" class="inline-form">
                    <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken ?? "")}" />
                    <span class="nav-user">${escapeHtml(user.email)}</span>
                    <button type="submit" class="link-button">Log out</button>
                  </form>
                </li>`
              : `<li><a href="/login" class="button button--outline">Log in</a></li><li><a href="/register" class="button button--primary">Register</a></li>`
          }
        </ul>
      </nav>
    </div>
  </header>
  <main id="main" class="site-main">
${body}
  </main>
  <footer class="site-footer">
    <p>Fieldmark is a course demo storefront. No real payments are taken.</p>
  </footer>
</body>
</html>`;
}
