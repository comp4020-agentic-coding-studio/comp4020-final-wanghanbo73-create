import type { ProductRow } from "../types.ts";
import { escapeHtml, money } from "./html.ts";

export function productCard(p: ProductRow, badgeHtml = ""): string {
  return `<li class="product-card" data-product-id="${p.id}" data-category="${escapeHtml(p.category)}">
    <a href="/products/${encodeURIComponent(p.slug)}">
      <div class="product-card__image-wrap">
        <img src="${escapeHtml(p.image_path)}" alt="" class="product-card__image" width="320" height="240" />
        ${badgeHtml ? `<div class="badge-row">${badgeHtml}</div>` : ""}
      </div>
      <p class="product-card__category">${escapeHtml(p.category)}</p>
      <h3 data-product-name>${escapeHtml(p.name)}</h3>
      <p class="product-card__price${p.sale_type === "limited" ? " product-card__price--limited" : ""}" data-product-price>${money(p.price_cents)}</p>
    </a>
  </li>`;
}

const ARROW_RIGHT_ICON = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
const ARROW_UP_RIGHT_ICON = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>`;

function heroFeatureTile(p: ProductRow): string {
  return `<a class="hero-tile hero-tile--feature hero-tile--dark" href="/products/${encodeURIComponent(p.slug)}">
    <div class="hero-tile__top">
      <span class="hero-tile__flag">Spotlight drop</span>
      <span class="hero-tile__top-price">${money(p.price_cents)}</span>
    </div>
    <div class="hero-tile__image-wrap">
      <img src="${escapeHtml(p.image_path)}" alt="" />
    </div>
    <div class="hero-tile__meta">
      <div>
        <span class="hero-tile__category">${escapeHtml(p.category)}</span>
        <p class="hero-tile__name">${escapeHtml(p.name)}</p>
      </div>
      <span class="hero-tile__arrow" aria-hidden="true">${ARROW_UP_RIGHT_ICON}</span>
    </div>
  </a>`;
}

function heroStackTile(p: ProductRow, variant: string): string {
  return `<a class="hero-tile ${variant}" href="/products/${encodeURIComponent(p.slug)}">
    <div class="hero-tile__top">
      <span class="hero-tile__flag">${escapeHtml(p.category)}</span>
      <span class="hero-tile__top-price">${money(p.price_cents)}</span>
    </div>
    <div class="hero-tile__image-wrap">
      <img src="${escapeHtml(p.image_path)}" alt="" />
    </div>
    <div class="hero-tile__meta">
      <p class="hero-tile__name">${escapeHtml(p.name)}</p>
      <span class="hero-tile__arrow" aria-hidden="true">${ARROW_RIGHT_ICON}</span>
    </div>
  </a>`;
}

const VALUE_PROPS = [
  {
    title: "Pick your size",
    body: "Choose the exact colour and size SKU before you buy.",
    icon: `<path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />`,
  },
  {
    title: "Track every order",
    body: "Order status is visible any time from My Orders.",
    icon: `<path d="M4 12l5 5L20 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none" />`,
  },
  {
    title: "Limited drops",
    body: "Capped per-account quantities, unlocking on a schedule.",
    icon: `<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.8" fill="none" /><path d="M12 7v5l3 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />`,
  },
  {
    title: "Browse without an account",
    body: "Sign up only when you're ready to buy.",
    icon: `<path d="M4 6h16v12H4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none" /><path d="M4 7l8 6 8-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />`,
  },
];

function valuePropsSection(): string {
  return `<section class="value-props-section">
    <ul class="value-props">
      ${VALUE_PROPS.map(
        (v) => `<li class="value-prop">
          <span class="value-prop__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">${v.icon}</svg>
          </span>
          <div>
            <h3>${escapeHtml(v.title)}</h3>
            <p>${escapeHtml(v.body)}</p>
          </div>
        </li>`,
      ).join("")}
    </ul>
  </section>`;
}

export function homePage(products: ProductRow[]): string {
  const heroProducts = products.slice(0, 3);
  const [feature, stackA, stackB] = heroProducts;
  return `
  <section class="hero">
    <div>
      <span class="hero__eyebrow">Clothing &amp; footwear</span>
      <h1 class="hero__title">Made in small batches,<br /><em>built to last.</em></h1>
      <p class="hero__subtitle">
        Regular stock and limited drops, all in one place. Pick a colour and
        size, check out, and track your order — no account required to browse.
      </p>
      <div class="hero__actions">
        <a href="#catalogue" class="button button--primary">Shop the catalogue</a>
        <a href="/limited" class="button button--outline">See limited drops</a>
      </div>
    </div>
    ${
      feature
        ? `<div class="hero__visual">
      ${heroFeatureTile(feature)}
      <div class="hero__visual-stack">
        ${stackA ? heroStackTile(stackA, "hero-tile--accent") : ""}
        ${stackB ? heroStackTile(stackB, "hero-tile--secondary") : ""}
      </div>
    </div>`
        : ""
    }
  </section>
  ${valuePropsSection()}
  <h2 id="catalogue" class="section-eyebrow">The catalogue</h2>
  ${
    products.length === 0
      ? `<p>No products available right now.</p>`
      : `<ul class="product-grid">${products
          .map((p) => productCard(p, p.sale_type === "limited" ? `<span class="badge">Limited</span>` : ""))
          .join("")}</ul>`
  }
  `;
}
