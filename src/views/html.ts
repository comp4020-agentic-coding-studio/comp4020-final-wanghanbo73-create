// Minimal hand-written templating: an escape function plus a couple of tag
// helpers, no templating engine dependency.

export function escapeHtml(str: string | number): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Joins template fragments, skipping falsy entries — handy for conditional
// blocks inside a page template without extra control-flow noise.
export function when(condition: unknown, html: string): string {
  return condition ? html : "";
}
