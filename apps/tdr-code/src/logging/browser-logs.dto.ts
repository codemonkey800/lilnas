import { z } from 'zod'

// Length caps are the only real guard against a misbehaving client flooding
// frontend-browser.<env>.log — there's no rate limiter anywhere in this app
// (POST /logs/browser is a normal guarded route, not @Public(), so the
// abuse surface is already small — see logging.module.ts's header comment —
// but the caps still bound worst-case single-line size).
export const BrowserLogEntrySchema = z.object({
  level: z.enum(['error', 'warn', 'info']),
  message: z.string().min(1).max(2000),
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
