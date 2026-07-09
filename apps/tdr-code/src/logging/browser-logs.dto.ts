import { z } from 'zod'

// Shape check only, not a membership check — deliberately not a z.enum
// against src/logging/log-events.ts's LogEvent registry. Ingestion must
// stay robust across deploy skew: an older frontend bundle can still be
// running in a user's tab after a slug is renamed/removed in that
// registry, and this endpoint should keep accepting its logs rather than
// 400 them. The regex is duplicated (not imported) from the pattern
// log-events.spec.ts asserts every registry slug against, because that
// registry file — and its spec — is out of scope for this ingestion path.
const KEBAB_CASE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

// Length caps are the only real guard against a misbehaving client flooding
// frontend-browser.<env>.log — there's no rate limiter anywhere in this app
// (POST /logs/browser is a normal guarded route, not @Public(), so the
// abuse surface is already small — see logging.module.ts's header comment —
// but the caps still bound worst-case single-line size).
export const BrowserLogEntrySchema = z.object({
  level: z.enum(['error', 'warn', 'info']),
  message: z.string().min(1).max(2000),
  // Optional structured slug identifying which UI event triggered this log
  // line (e.g. 'button-click'). Kept as a shape-validated string, not an
  // enum, so this endpoint tolerates slug drift between the frontend
  // bundle a client has loaded and whatever the backend's LogEvent
  // registry currently contains — see KEBAB_CASE_PATTERN's comment above.
  // The .max(64) is a per-line size guard only, not a semantic constraint.
  event: z.string().regex(KEBAB_CASE_PATTERN).max(64).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  // Path + query ONLY (window.location.pathname + search — see
  // src/app/lib/browser-logger.ts), never the full origin-qualified href.
  // browser-logs.service.ts's redaction reuses src/logger.ts's
  // redactionCensor to strip OAuth code/state off an /auth/* URL, and that
  // check is written against a path-only string (matching how it sees
  // req.url on the backend) — a full https://host/auth/... value would
  // silently skip the check instead of failing loudly, so this is enforced
  // at the source (the client never sends the origin) rather than
  // re-parsed out of an absolute URL here.
  url: z.string().max(2000).optional(),
  userAgent: z.string().max(500).optional(),
})
export type BrowserLogEntryDto = z.infer<typeof BrowserLogEntrySchema>
