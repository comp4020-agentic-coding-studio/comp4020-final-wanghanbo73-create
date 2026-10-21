import { escapeHtml } from "./html.ts";

// Always rendered collapsed — the trigger button toggles the panel's
// `hidden` attribute client-side, no server round-trip needed to open it.
export function aiChatWidget(csrfToken: string, available: boolean): string {
  return `
  <div class="ai-chat-widget">
    <button
      type="button"
      id="ai-chat-toggle"
      class="ai-chat-widget__toggle"
      aria-expanded="false"
      aria-controls="ai-chat-panel"
      aria-label="Open AI customer service chat"
    >
      <svg class="ai-chat-widget__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path
          d="M4 5h16v11H9l-4 4V5z"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linejoin="round"
        />
      </svg>
    </button>
    <div id="ai-chat-panel" class="ai-chat-widget__panel" hidden role="dialog" aria-label="AI customer service chat">
      <div class="ai-chat-widget__header">
        <h2 class="ai-chat-widget__title">AI Customer Service</h2>
        <button type="button" id="ai-chat-close" class="ai-chat-widget__close" aria-label="Close chat">&times;</button>
      </div>
      ${
        available
          ? ""
          : `<p class="notice notice--error" role="alert">The AI assistant isn't configured right now — you can still browse <a href="/">the catalogue</a> or check <a href="/orders">your orders</a> directly.</p>`
      }
      <div id="ai-chat-log" class="ai-chat-log" role="log" aria-live="polite" aria-label="Conversation with AI customer service"></div>
      <p id="ai-chat-status" class="ai-chat-status" role="status"></p>
      <form id="ai-chat-form" class="ai-chat-form">
        <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}" />
        <label for="ai-chat-input" class="visually-hidden">Your message</label>
        <textarea id="ai-chat-input" name="message" rows="2" required ${available ? "" : "disabled"}></textarea>
        <button type="submit" class="button button--primary" ${available ? "" : "disabled"}>Send</button>
      </form>
    </div>
  </div>
  `;
}
