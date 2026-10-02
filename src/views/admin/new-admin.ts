import { escapeHtml, when } from "../html.ts";

export interface NewAdminPageOptions {
  csrfToken: string;
  error?: string;
}

export function newAdminPage({ csrfToken, error }: NewAdminPageOptions): string {
  return `
  <h1>Create admin account</h1>
  <div class="panel">
    ${when(error, `<p class="notice notice--error" role="alert">${escapeHtml(error ?? "")}</p>`)}
    <form method="post" action="/admin/admins" class="auth-form">
      <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}" />
      <div class="field">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="username" required />
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="new-password" minlength="8" required />
      </div>
      <button type="submit" class="button button--primary">Create admin</button>
    </form>
  </div>
  `;
}
