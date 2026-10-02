import { marked } from "marked";

export function readmePage(markdown: string): string {
  const rendered = marked.parse(markdown, { async: false });
  return `
  <article class="readme">
${rendered}
  </article>
  `;
}
