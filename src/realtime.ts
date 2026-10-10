import type { Response } from "express";

// A minimal in-process SSE hub. One Node process, one SQLite file — the same
// assumption the rest of the app already makes (see docs/adr/0001-stack.md)
// — so a plain Map of open responses is the whole implementation; no pub/sub
// broker needed.

const channels = new Map<string, Set<Response>>();

export function subscribe(channel: string, res: Response): () => void {
  let subscribers = channels.get(channel);
  if (!subscribers) {
    subscribers = new Set();
    channels.set(channel, subscribers);
  }
  subscribers.add(res);
  return () => {
    subscribers!.delete(res);
    if (subscribers!.size === 0) channels.delete(channel);
  };
}

export function publish(channel: string, type: string, data: unknown): void {
  const subscribers = channels.get(channel);
  if (!subscribers || subscribers.size === 0) return;
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of subscribers) {
    res.write(payload);
  }
}

// Keeps idle SSE connections alive through intermediary proxies (Fly's edge
// included), which otherwise treat a long silent connection as dead.
setInterval(() => {
  for (const subscribers of channels.values()) {
    for (const res of subscribers) {
      res.write(": heartbeat\n\n");
    }
  }
}, 20_000).unref();
