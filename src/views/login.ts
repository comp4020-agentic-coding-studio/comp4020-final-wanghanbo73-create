import { escapeHtml, when } from "./html.ts";

export interface LoginPageOptions {
  csrfToken: string;
  next: string;
  error?: string;
}

export function loginPage({ csrfToken, next, error }: LoginPageOptions): string {
  return `
  <h1>Log in</h1>
  ${when(error, `<p class="notice notice--error" role="alert">${escapeHtml(error ?? "")}</p>`)}
  <form method="post" action="/login?next=${encodeURIComponent(next)}" class="auth-form">
    <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}" />
    <div class="field">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="username" required />
    </div>
    <div class="field">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
    </div>
    <button type="submit" class="button button--primary">Log in</button>
  </form>
  <p>No account? <a href="/register?next=${encodeURIComponent(next)}">Register</a></p>
  `;
}
