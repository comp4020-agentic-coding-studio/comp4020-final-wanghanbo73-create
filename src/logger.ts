import type { Request } from "express";

// One JSON line per event to stdout — Fly captures a machine's stdout and
// `flyctl logs` tails it, so this needs no logging service or dependency
// (see docs/adr/0003-identity-and-logging.md). Never log passwords, CSRF
// tokens, or raw cookie/session-id values — `actorFromRequest` below only
// ever exposes a truncated session id, never enough to replay a session.

export type ActorKind = "customer" | "admin" | "anon";

export interface Actor {
  kind: ActorKind;
  id?: number;
  email?: string;
  anonId?: string;
}

// Distinguishes two signed-out browsers from each other in the log stream
// (e.g. two people both on /register before either has an account) without
// exposing enough of the session id to do anything with it.
function shortSessionId(sessionID: string | undefined): string | undefined {
  return sessionID ? sessionID.slice(0, 8) : undefined;
}

export function actorFromRequest(req: Request): Actor {
  const user = req.session.user;
  if (user) {
    return { kind: user.role, id: user.id, email: user.email };
  }
  return { kind: "anon", anonId: shortSessionId(req.sessionID) };
}

export function logEvent(event: string, req: Request | null, fields: Record<string, unknown> = {}): void {
  const line = {
    ts: new Date().toISOString(),
    event,
    actor: req ? actorFromRequest(req) : undefined,
    ip: req?.ip,
    ...fields,
  };
  console.log(JSON.stringify(line));
}
