(function () {
  var toggle = document.getElementById("ai-chat-toggle");
  var panel = document.getElementById("ai-chat-panel");
  var closeButton = document.getElementById("ai-chat-close");
  var form = document.getElementById("ai-chat-form");
  if (!toggle || !panel || !form) return;

  var log = document.getElementById("ai-chat-log");
  var status = document.getElementById("ai-chat-status");
  var input = document.getElementById("ai-chat-input");
  var sendButton = form.querySelector("button[type=submit]");
  var csrfInput = form.querySelector('input[name="_csrf"]');

  // In-memory only — a reload or navigating away drops this, by design (the
  // chat isn't persisted server-side either).
  var history = [];

  function openPanel() {
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    if (input && !input.disabled) input.focus();
  }

  function closePanel() {
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.focus();
  }

  toggle.addEventListener("click", function () {
    if (panel.hidden) {
      openPanel();
    } else {
      closePanel();
    }
  });

  if (closeButton) {
    closeButton.addEventListener("click", closePanel);
  }

  panel.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
    }
  });

  function appendMessage(role, text) {
    var wrapper = document.createElement("p");
    wrapper.className = "ai-chat-message ai-chat-message--" + role;
    var label = document.createElement("strong");
    label.textContent = role === "user" ? "You: " : "Assistant: ";
    wrapper.appendChild(label);
    var span = document.createElement("span");
    span.textContent = text;
    wrapper.appendChild(span);
    log.appendChild(wrapper);
    log.scrollTop = log.scrollHeight;
    return span;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var message = input.value.trim();
    if (!message) return;

    appendMessage("user", message);
    history.push({ role: "user", content: message });
    input.value = "";
    input.disabled = true;
    sendButton.disabled = true;
    status.textContent = "Assistant is responding…";

    var replySpan = appendMessage("assistant", "");
    var replyText = "";

    fetch("/ai-chat/stream", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: message,
        history: history,
        _csrf: csrfInput ? csrfInput.value : undefined,
      }),
    })
      .then(function (res) {
        if (!res.ok || !res.body) {
          throw new Error("request failed with status " + res.status);
        }
        var reader = res.body.getReader();
        var decoder = new TextDecoder();

        function pump() {
          return reader.read().then(function (result) {
            if (result.done) return;
            replyText += decoder.decode(result.value, { stream: true });
            replySpan.textContent = replyText;
            log.scrollTop = log.scrollHeight;
            return pump();
          });
        }
        return pump();
      })
      .then(function () {
        history.push({ role: "assistant", content: replyText });
        status.textContent = "";
      })
      .catch(function () {
        replySpan.textContent = replyText || "Sorry, something went wrong. Please try again.";
        status.textContent = "There was a problem reaching the assistant.";
      })
      .finally(function () {
        input.disabled = false;
        sendButton.disabled = false;
        input.focus();
      });
  });
})();
