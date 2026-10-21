import { Router } from "express";
import { requireCustomer } from "../auth.ts";
import { logEvent } from "../logger.ts";
import { streamChatReply } from "../ai-chat.ts";

export const aiChatRouter = Router();

// The chat UI itself is a widget rendered inline by layout() on every logged-in
// page (see views/ai-chat-widget.ts) — this router only serves the streaming
// endpoint it talks to.
aiChatRouter.post("/ai-chat/stream", requireCustomer, (req, res) => {
  const user = req.session.user!;
  const body = req.body as { message?: unknown; history?: unknown } | undefined;
  const message = typeof body?.message === "string" ? body.message.trim() : "";

  if (!message) {
    res.status(400).type("text/plain").send("Message is required.");
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  });

  const start = process.hrtime.bigint();
  streamChatReply(user, body?.history, message, res)
    .then((result) => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      logEvent("ai_chat.message", req, {
        messageLength: message.length,
        toolCalls: result.toolCalls,
        outputChars: result.outputChars,
        durationMs: Math.round(durationMs),
      });
      res.end();
    })
    .catch((error: unknown) => {
      logEvent("ai_chat.error", req, {
        messageLength: message.length,
        error: error instanceof Error ? error.message : "unknown error",
      });
      res.end("\n\n[Sorry, something went wrong while generating a response.]");
    });
});
