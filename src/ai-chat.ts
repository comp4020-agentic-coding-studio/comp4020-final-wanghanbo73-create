import Anthropic from "@anthropic-ai/sdk";
import type { Response } from "express";
import { db } from "./db.ts";
import type { OrderItemRow, OrderRow, SessionUser, SkuRow } from "./types.ts";

// Keeps the loop from running away on tool-call ping-pong, and keeps a single
// reply's cost bounded regardless of what the model decides to do.
const MAX_TOKENS = 1024;
const MAX_TOOL_ITERATIONS = 4;
const MAX_HISTORY_MESSAGES = 20;

const SYSTEM_PROMPT = `You are Fieldmark's AI customer service assistant. Fieldmark is a small
clothing/footwear storefront. Help the signed-in customer with questions about products, stock,
and their own past orders. Use the provided tools to look up real data instead of guessing — never
invent stock numbers, prices, or order details. Keep answers brief and friendly. You cannot place
orders, change orders, or access any other customer's data.`;

// Backend selection follows the same "env var, Fly secret in prod" convention as
// ADMIN_EMAIL/SESSION_SECRET. Local dev defaults to a free local Ollama model so
// nobody needs an API key to try the feature; deploying with AI_BACKEND=anthropic
// (and ANTHROPIC_API_KEY as a Fly secret) switches to the hosted API instead —
// the 256MB Fly machine has no room to run a local model.
const BACKEND = process.env.AI_BACKEND === "anthropic" ? "anthropic" : "ollama";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:1.5b";

const anthropicClient =
  BACKEND === "anthropic" && process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

// Ollama runs as a local daemon with no API key, so "available" just means
// "the daemon answered a health check" — checked once at boot and refreshed
// on demand if it was down, rather than blocking startup on a network call.
let ollamaAvailable = BACKEND === "ollama";

async function checkOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(new URL("/api/tags", OLLAMA_BASE_URL));
    ollamaAvailable = res.ok;
  } catch {
    ollamaAvailable = false;
  }
  return ollamaAvailable;
}

if (BACKEND === "ollama") {
  void checkOllamaAvailable();
} else if (!anthropicClient) {
  console.warn(
    "[ai-chat] AI_BACKEND=anthropic but ANTHROPIC_API_KEY not set — the AI customer service chat will report itself as unavailable",
  );
}

export function isChatAvailable(): boolean {
  return BACKEND === "anthropic" ? anthropicClient !== null : ollamaAvailable;
}

export interface ChatHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

// Only the current user's own rows, scoped by the server-trusted session id —
// never by anything the client sends. Mirrors GET /orders in routes/orders.ts.
function getMyOrders(userId: number): unknown {
  const orders = db
    .prepare<[number], OrderRow>("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 20")
    .all(userId);
  return orders.map((order) => {
    const items = db
      .prepare<[number], OrderItemRow>("SELECT * FROM order_items WHERE order_id = ?")
      .all(order.id);
    return {
      id: order.id,
      status: order.status,
      created_at: order.created_at,
      items: items.map((item) => ({
        product: item.product_name_snapshot,
        color: item.color_snapshot,
        size: item.size_snapshot,
        quantity: item.quantity,
        unit_price_cents: item.unit_price_cents_snapshot,
      })),
    };
  });
}

// Read-only product/stock lookup, same tables the catalogue already exposes
// publicly — no access-control concern beyond "active products only".
function getProductStock(query: string): unknown {
  const products = db
    .prepare<[string, string], { id: number; slug: string; name: string; price_cents: number }>(
      `SELECT id, slug, name, price_cents FROM products
       WHERE active = 1 AND (name LIKE ? OR slug LIKE ?)
       ORDER BY name LIMIT 5`,
    )
    .all(`%${query}%`, `%${query}%`);
  return products.map((product) => {
    const skus = db
      .prepare<[number], SkuRow>("SELECT color, size, stock FROM skus WHERE product_id = ?")
      .all(product.id);
    return {
      name: product.name,
      slug: product.slug,
      price_cents: product.price_cents,
      skus: skus.map((s) => ({ color: s.color, size: s.size, stock: s.stock })),
    };
  });
}

function runTool(name: string, input: Record<string, unknown>, user: SessionUser): unknown {
  if (name === "get_my_orders") return getMyOrders(user.id);
  if (name === "get_product_stock") return getProductStock(String(input.query ?? ""));
  return { error: `unknown tool: ${name}` };
}

function sanitizeHistory(history: unknown): ChatHistoryEntry[] {
  if (!Array.isArray(history)) return [];
  const entries: ChatHistoryEntry[] = [];
  for (const entry of history) {
    if (
      entry &&
      typeof entry === "object" &&
      (entry as { role?: unknown }).role &&
      ((entry as { role?: unknown }).role === "user" || (entry as { role?: unknown }).role === "assistant") &&
      typeof (entry as { content?: unknown }).content === "string"
    ) {
      entries.push(entry as ChatHistoryEntry);
    }
  }
  return entries.slice(-MAX_HISTORY_MESSAGES);
}

export interface StreamChatResult {
  toolCalls: number;
  outputChars: number;
}

const anthropicTools: Anthropic.Tool[] = [
  {
    name: "get_my_orders",
    description:
      "Look up the signed-in customer's own past orders, including status and line items. Takes no input.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_product_stock",
    description:
      "Look up current price and per-colour/size stock for products matching a name or slug keyword (e.g. 'hoodie', 'classic-tee').",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Product name or slug keyword to search for" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
];

async function streamChatReplyAnthropic(
  user: SessionUser,
  history: unknown,
  message: string,
  res: Response,
): Promise<StreamChatResult> {
  if (!anthropicClient) {
    res.write("Sorry — the AI customer service assistant isn't configured right now. Please try again later.");
    return { toolCalls: 0, outputChars: 0 };
  }

  const messages: Anthropic.MessageParam[] = [
    ...sanitizeHistory(history).map((entry) => ({ role: entry.role, content: entry.content })),
    { role: "user" as const, content: message },
  ];

  let toolCalls = 0;
  let outputChars = 0;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const stream = anthropicClient.messages.stream({
      model: "claude-opus-5",
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: anthropicTools,
      messages,
    });

    stream.on("text", (delta) => {
      outputChars += delta.length;
      res.write(delta);
    });

    const final = await stream.finalMessage();

    if (final.stop_reason !== "tool_use") break;

    messages.push({ role: "assistant", content: final.content });

    const toolUseBlocks = final.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    const toolResults: Anthropic.ToolResultBlockParam[] = toolUseBlocks.map((block) => {
      toolCalls++;
      const result = runTool(block.name, block.input as Record<string, unknown>, user);
      return { type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) };
    });
    messages.push({ role: "user", content: toolResults });
  }

  return { toolCalls, outputChars };
}

// OpenAI-style function tool definitions — the shape Ollama's /api/chat and
// /v1/chat/completions both expect for tool-capable models like qwen2.5.
const ollamaTools = [
  {
    type: "function",
    function: {
      name: "get_my_orders",
      description:
        "Look up the signed-in customer's own past orders, including status and line items. Takes no input.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_product_stock",
      description:
        "Look up current price and per-colour/size stock for products matching a name or slug keyword (e.g. 'hoodie', 'classic-tee').",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Product name or slug keyword to search for" },
        },
        required: ["query"],
      },
    },
  },
];

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
}

interface OllamaChatChunk {
  message?: { role: string; content?: string; tool_calls?: OllamaMessage["tool_calls"] };
  done: boolean;
}

// Reads Ollama's newline-delimited JSON stream, forwarding text deltas onto
// `res` as they arrive and collecting any tool calls the model emits.
async function readOllamaStream(
  body: ReadableStream<Uint8Array>,
  res: Response,
  onText: (delta: string) => void,
): Promise<{ toolCalls: NonNullable<OllamaMessage["tool_calls"]>; assistantContent: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let assistantContent = "";
  let toolCalls: NonNullable<OllamaMessage["tool_calls"]> = [];

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const chunk = JSON.parse(line) as OllamaChatChunk;
      const delta = chunk.message?.content ?? "";
      if (delta) {
        assistantContent += delta;
        res.write(delta);
        onText(delta);
      }
      if (chunk.message?.tool_calls?.length) {
        toolCalls = chunk.message.tool_calls;
      }
    }
  }

  return { toolCalls, assistantContent };
}

async function streamChatReplyOllama(
  user: SessionUser,
  history: unknown,
  message: string,
  res: Response,
): Promise<StreamChatResult> {
  if (!(await checkOllamaAvailable())) {
    res.write("Sorry — the AI customer service assistant isn't configured right now. Please try again later.");
    return { toolCalls: 0, outputChars: 0 };
  }

  const messages: OllamaMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...sanitizeHistory(history).map((entry) => ({ role: entry.role, content: entry.content })),
    { role: "user", content: message },
  ];

  let toolCallCount = 0;
  let outputChars = 0;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const response = await fetch(new URL("/api/chat", OLLAMA_BASE_URL), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        tools: ollamaTools,
        stream: true,
        options: { num_predict: MAX_TOKENS },
      }),
    });

    if (!response.ok || !response.body) {
      res.write("\n\n[Sorry, the local AI model isn't responding right now.]");
      break;
    }

    const { toolCalls, assistantContent } = await readOllamaStream(response.body, res, (delta) => {
      outputChars += delta.length;
    });

    if (toolCalls.length === 0) break;

    messages.push({ role: "assistant", content: assistantContent, tool_calls: toolCalls });
    for (const call of toolCalls) {
      toolCallCount++;
      const result = runTool(call.function.name, call.function.arguments, user);
      messages.push({ role: "tool", content: JSON.stringify(result) });
    }
  }

  // A small model can spend every tool-call iteration without ever emitting
  // final narration text — don't send back an empty response body in that case.
  if (outputChars === 0) {
    const fallback = "Sorry, I couldn't come up with an answer to that. Could you rephrase your question?";
    res.write(fallback);
    outputChars = fallback.length;
  }

  return { toolCalls: toolCallCount, outputChars };
}

// Streams the assistant's reply text directly onto `res` as plain chunks,
// running the tool-use loop server-side in between. The client never sees
// tool_use/tool_result blocks — only the final narrated text.
export async function streamChatReply(
  user: SessionUser,
  history: unknown,
  message: string,
  res: Response,
): Promise<StreamChatResult> {
  return BACKEND === "anthropic"
    ? streamChatReplyAnthropic(user, history, message, res)
    : streamChatReplyOllama(user, history, message, res);
}
