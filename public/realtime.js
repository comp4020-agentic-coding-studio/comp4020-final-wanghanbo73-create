// Live-view patching over Server-Sent Events. Read-only views only — see
// docs/adr/0002-realtime-concurrency.md for why this never touches an open
// form (product edit, stock edit, status select).
(function () {
  function money(cents) {
    return "$" + (cents / 100).toFixed(2);
  }

  function statusBadgeClass(status) {
    if (status === "cancelled") return "badge--soldout";
    if (status === "completed") return "badge--live";
    return "badge--pending";
  }

  function updateProductSoldOut(article) {
    var options = article.querySelectorAll("option[data-sku-id]");
    if (!options.length) return;
    var allSoldOut = Array.prototype.every.call(options, function (o) {
      return o.disabled;
    });
    var notice = article.querySelector("[data-availability-notice]");
    var button = article.querySelector("[data-buy-button]");
    if (button && button.hasAttribute("data-force-disabled")) return;
    if (allSoldOut) {
      if (notice) notice.innerHTML = '<p class="notice notice--error" role="alert">All colours/sizes are sold out.</p>';
      if (button) {
        button.disabled = true;
        button.textContent = "Sold out";
      }
    } else {
      if (notice) notice.innerHTML = "";
      if (button) {
        button.disabled = false;
        button.textContent = "Buy";
      }
    }
  }

  function patchStock(skuId, stock) {
    var options = document.querySelectorAll('option[data-sku-id="' + skuId + '"]');
    options.forEach(function (opt) {
      var soldOut = stock <= 0;
      opt.dataset.stock = String(stock);
      opt.disabled = soldOut;
      var label = (opt.textContent.split("—")[0] || "").trim();
      opt.textContent = label + " — " + (soldOut ? "SOLD OUT" : stock + " in stock");
      var article = opt.closest(".product-detail");
      if (article) updateProductSoldOut(article);
    });
  }

  function patchProductActive(productId, active) {
    document.querySelectorAll('[data-product-id="' + productId + '"]').forEach(function (el) {
      if (el.classList.contains("product-card")) {
        el.style.display = active ? "" : "none";
        return;
      }
      if (el.classList.contains("product-detail")) {
        var notice = el.querySelector("[data-availability-notice]");
        var button = el.querySelector("[data-buy-button]");
        var select = el.querySelector("select");
        var qty = el.querySelector('input[name="qty"]');
        if (!active) {
          if (notice) notice.innerHTML = '<p class="notice notice--error" role="alert">This item is no longer available.</p>';
          if (button) {
            button.disabled = true;
            button.setAttribute("data-force-disabled", "1");
            button.textContent = "Not available";
          }
          if (select) select.disabled = true;
          if (qty) qty.disabled = true;
        } else {
          if (button) button.removeAttribute("data-force-disabled");
          if (select) select.disabled = false;
          if (qty) qty.disabled = false;
          updateProductSoldOut(el);
        }
      }
    });
  }

  function patchProductUpdated(data) {
    document.querySelectorAll('[data-product-id="' + data.productId + '"]').forEach(function (el) {
      var nameEl = el.querySelector("[data-product-name]");
      var priceEl = el.querySelector("[data-product-price], .product-detail__price");
      if (nameEl) nameEl.textContent = data.name;
      if (priceEl) priceEl.textContent = money(data.price_cents);
    });
    patchProductActive(data.productId, !!data.active);
  }

  function patchOrderStatus(orderId, status) {
    document.querySelectorAll('[data-order-id="' + orderId + '"]').forEach(function (el) {
      var badge = el.hasAttribute("data-order-status") ? el : el.querySelector("[data-order-status]");
      if (!badge) return;
      badge.textContent = status;
      badge.className = "badge " + statusBadgeClass(status);
    });
  }

  function patchUnreadCount(count) {
    var el = document.getElementById("notif-badge");
    if (!el) return;
    el.dataset.unreadCount = String(count);
    el.setAttribute("aria-label", count > 0 ? "Notifications, " + count + " unread" : "Notifications");
    var badge = el.querySelector(".icon-link__badge");
    if (count > 0) {
      var text = count > 99 ? "99+" : String(count);
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "icon-link__badge";
        badge.setAttribute("aria-hidden", "true");
        el.appendChild(badge);
      }
      badge.textContent = text;
    } else if (badge) {
      badge.remove();
    }
  }

  function handleNewOrder(data) {
    var body = document.getElementById("admin-orders-body");
    if (!body || body.querySelector('[data-order-id="' + data.orderId + '"]')) return;
    var tr = document.createElement("tr");
    tr.setAttribute("data-order-id", String(data.orderId));
    tr.innerHTML =
      "<td>#" + data.orderId + '</td><td colspan="3">New order just placed</td>' +
      '<td><a href="/admin/orders">Refresh to manage</a></td>';
    body.insertBefore(tr, body.firstChild);
  }

  function collectResyncTargets() {
    var skuIds = Array.prototype.map
      .call(document.querySelectorAll("[data-sku-id]"), function (el) {
        return el.getAttribute("data-sku-id");
      })
      .filter(Boolean);
    var orderEl = document.querySelector("[data-order-id][data-order-status]");
    var orderId = orderEl ? orderEl.getAttribute("data-order-id") : null;
    return { skuIds: skuIds, orderId: orderId };
  }

  // Catches up on whatever was missed while disconnected. EventSource fires
  // "open" on the first connect and again after every auto-reconnect, so
  // this is the one place a dropped-connection gap gets corrected.
  function resync() {
    var targets = collectResyncTargets();
    if (!targets.skuIds.length && !targets.orderId) return;
    var params = new URLSearchParams();
    if (targets.skuIds.length) params.set("skus", targets.skuIds.join(","));
    if (targets.orderId) params.set("order", targets.orderId);
    fetch("/events/resync?" + params.toString(), { credentials: "same-origin" })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        (data.skus || []).forEach(function (s) {
          patchStock(s.id, s.stock);
        });
        if (data.order && targets.orderId) {
          patchOrderStatus(targets.orderId, data.order.status);
        }
      })
      .catch(function () {
        // Best-effort — the next live event will still self-correct.
      });
  }

  if (typeof EventSource === "undefined") return;
  var es = new EventSource("/events");

  es.addEventListener("stock", function (e) {
    var data = JSON.parse(e.data);
    patchStock(data.skuId, data.stock);
  });
  es.addEventListener("product_active", function (e) {
    var data = JSON.parse(e.data);
    patchProductActive(data.productId, !!data.active);
  });
  es.addEventListener("product_updated", function (e) {
    patchProductUpdated(JSON.parse(e.data));
  });
  es.addEventListener("order_status", function (e) {
    var data = JSON.parse(e.data);
    patchOrderStatus(data.orderId, data.status);
    if (typeof data.unreadCount === "number") patchUnreadCount(data.unreadCount);
  });
  es.addEventListener("new_order", function (e) {
    handleNewOrder(JSON.parse(e.data));
  });
  es.onopen = resync;
})();
