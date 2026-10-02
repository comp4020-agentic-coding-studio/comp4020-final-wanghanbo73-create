import type { ProductRow, SkuRow } from "../../types.ts";
import { escapeHtml, when } from "../html.ts";

export interface ProductEditPageOptions {
  product?: ProductRow;
  skus: SkuRow[];
  csrfToken: string;
  error?: string;
}

function option(value: string, label: string, selected: boolean): string {
  return `<option value="${value}" ${selected ? "selected" : ""}>${label}</option>`;
}

export function productEditPage({ product, skus, csrfToken, error }: ProductEditPageOptions): string {
  const isNew = !product;
  const action = isNew ? "/admin/products/new" : `/admin/products/${product.id}/edit`;

  return `
  <h1>${isNew ? "New product" : `Edit ${escapeHtml(product.name)}`}</h1>
  ${when(error, `<p class="notice notice--error" role="alert">${escapeHtml(error ?? "")}</p>`)}
  <form method="post" action="${action}" class="admin-form">
    <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}" />
    <div class="field">
      <label for="name">Name</label>
      <input id="name" name="name" required value="${escapeHtml(product?.name ?? "")}" />
    </div>
    <div class="field">
      <label for="slug">Slug</label>
      <input id="slug" name="slug" required pattern="[a-z0-9-]+" value="${escapeHtml(product?.slug ?? "")}" ${isNew ? "" : "readonly"} />
    </div>
    <div class="field">
      <label for="description">Description</label>
      <textarea id="description" name="description" required>${escapeHtml(product?.description ?? "")}</textarea>
    </div>
    <div class="field">
      <label for="price">Price (cents)</label>
      <input id="price" name="price_cents" type="number" min="0" required value="${product?.price_cents ?? 0}" />
    </div>
    <div class="field">
      <label for="category">Category</label>
      <select id="category" name="category" required>
        ${option("clothing", "Clothing", product?.category === "clothing")}
        ${option("footwear", "Footwear", product?.category === "footwear")}
      </select>
    </div>
    <div class="field">
      <label for="sale_type">Sale type</label>
      <select id="sale_type" name="sale_type" required>
        ${option("regular", "Regular", product?.sale_type === "regular")}
        ${option("limited", "Limited", product?.sale_type === "limited")}
      </select>
    </div>
    <div class="field">
      <label for="release_at">Release time (ISO, limited only)</label>
      <input id="release_at" name="release_at" value="${escapeHtml(product?.release_at ?? "")}" />
    </div>
    <div class="field">
      <label for="per_account_limit">Per-account limit (limited only)</label>
      <input id="per_account_limit" name="per_account_limit" type="number" min="1" value="${product?.per_account_limit ?? ""}" />
    </div>
    <div class="field">
      <label for="image_path">Image path</label>
      <input id="image_path" name="image_path" value="${escapeHtml(product?.image_path ?? "/images/placeholder.svg")}" />
    </div>
    <div class="field field--checkbox">
      <label for="active">
        <input id="active" name="active" type="checkbox" value="1" ${!product || product.active ? "checked" : ""} />
        Active
      </label>
    </div>
    <button type="submit" class="button button--primary">${isNew ? "Create product" : "Save changes"}</button>
  </form>
  ${
    !isNew
      ? `
  <h2>SKUs (colour / size / stock)</h2>
  <table class="data-table">
    <thead><tr><th>Colour</th><th>Size</th><th>Stock</th><th></th></tr></thead>
    <tbody>
      ${skus
        .map(
          (s) => `<tr>
            <td>${escapeHtml(s.color)}</td>
            <td>${escapeHtml(s.size)}</td>
            <td>
              <form method="post" action="/admin/products/${product.id}/edit" class="inline-form">
                <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}" />
                <input type="hidden" name="update_sku_id" value="${s.id}" />
                <input type="number" min="0" name="stock" value="${s.stock}" aria-label="Stock for ${escapeHtml(s.color)} ${escapeHtml(s.size)}" />
                <button type="submit" class="button">Update</button>
              </form>
            </td>
            <td></td>
          </tr>`,
        )
        .join("")}
    </tbody>
  </table>
  <h3>Add SKU</h3>
  <form method="post" action="/admin/products/${product.id}/edit" class="inline-form">
    <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}" />
    <input type="hidden" name="add_sku" value="1" />
    <label>Colour <input name="color" required /></label>
    <label>Size <input name="size" required /></label>
    <label>Stock <input name="stock" type="number" min="0" value="0" required /></label>
    <button type="submit" class="button">Add SKU</button>
  </form>`
      : ""
  }
  `;
}
