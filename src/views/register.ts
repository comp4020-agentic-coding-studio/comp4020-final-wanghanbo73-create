import { escapeHtml, when } from "./html.ts";

export interface RegisterPageOptions {
  csrfToken: string;
  next: string;
  error?: string;
}

export function registerPage({ csrfToken, next, error }: RegisterPageOptions): string {
  return `
  <div class="panel">
    <h1>Register</h1>
    ${when(error, `<p class="notice notice--error" role="alert">${escapeHtml(error ?? "")}</p>`)}
    <form method="post" action="/register?next=${encodeURIComponent(next)}" class="auth-form">
      <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}" />
      <div class="field">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="username" required />
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="new-password" minlength="8" required />
      </div>
      <button type="submit" class="button button--primary">Register</button>
    </form>
    <p>Already have an account? <a href="/login?next=${encodeURIComponent(next)}">Log in</a></p>
  </div>
  `;
}
