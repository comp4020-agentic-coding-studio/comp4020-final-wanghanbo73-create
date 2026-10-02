import { csrfSync } from "csrf-sync";
import type { Request } from "express";

// Synchronizer-token pattern against the session (csurf's maintained
// successor). Tokens live in req.session.csrfToken; forms embed them as a
// hidden `_csrf` input, read back here on POST.
const { csrfSynchronisedProtection, generateToken } = csrfSync({
  getTokenFromRequest: (req) => (req.body as Record<string, unknown> | undefined)?._csrf as
    | string
    | undefined,
});

export const csrfProtection = csrfSynchronisedProtection;

// Views call this to get the token to embed as a hidden input. Reuses the
// existing session token instead of minting a new one on every render.
export function csrfToken(req: Request): string {
  return generateToken(req);
}
