import type { ProductRow } from "../../types.ts";
import { escapeHtml, money } from "../html.ts";

export function adminProductsPage(products: ProductRow[], csrfToken: string): string {
  return `
  <h1>Products</h1>
  <p><a href="/admin/products/new" class="button button--primary">New product</a></p>
  <table class="data-table">
    <thead>
      <tr><th>Name</th><th>Category</th><th>Sale type</th><th>Price</th><th>Active</th><th></th></tr>
    </thead>
    <tbody>
      ${products
        .map(
          (p) => `<tr>
            <td>${escapeHtml(p.name)}</td>
            <td>${escapeHtml(p.category)}</td>
            <td>${escapeHtml(p.sale_type)}</td>
            <td>${money(p.price_cents)}</td>
            <td><span class="badge ${p.active ? "badge--live" : "badge--soldout"}">${p.active ? "Active" : "Inactive"}</span></td>
            <td>
              <a href="/admin/products/${p.id}/edit">Edit</a>
              <form method="post" action="/admin/products/${p.id}/edit" class="inline-form">
                <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}" />
                <input type="hidden" name="toggle_active" value="1" />
                <button type="submit" class="link-button">${p.active ? "Deactivate" : "Activate"}</button>
              </form>
            </td>
          </tr>`,
        )
        .join("")}
    </tbody>
  </table>
  `;
}
