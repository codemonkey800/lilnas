import { z } from 'zod'

import type { LogStream } from 'src/logging/log-paths'

// @Query() delivers strings/undefined with no coercion — mirrors
// console/query-params.ts's own convention (parseQuery + this module's
// schemas). stream is the R17 enforcement point: only a name from the fixed
// LogStream union is ever accepted, so no client-supplied path reaches fs.
const LOG_STREAMS: readonly LogStream[] = [
  'backend',
  'frontend-server',
  'frontend-browser',
]

export const LogWindowQuerySchema = z.object({
  stream: z
    .string()
    .refine(v => (LOG_STREAMS as readonly string[]).includes(v), {
      message: `stream must be one of: ${LOG_STREAMS.join(', ')}`,
    })
    .transform(v => v as LogStream),
  anchor: z
    .string()
    .transform(v => parseInt(v, 10))
    .pipe(z.number().int().min(0)),
  direction: z.enum(['before', 'after', 'around']),
  // Optional — the service clamps to the env-configured cap regardless of
  // what a client requests, so this schema only needs to reject a
  // non-numeric/negative value, not enforce the cap itself.
  maxBytes: z
    .string()
    .optional()
    .transform(v => (v === undefined ? undefined : parseInt(v, 10)))
    .pipe(z.number().int().positive().optional()),
})

export type LogWindowQuery = z.infer<typeof LogWindowQuerySchema>

// Phase 2 U8 (append-delta tail push endpoint) query: same R17 `stream`
// allowlist enforcement as LogWindowQuerySchema above (re-using the same
// LOG_STREAMS array so the two schemas can never accept a different set of
// streams). `from` is the FIRST-CONNECT resume offset only — the
// `Last-Event-ID` header (parsed directly in the controller, not through
// this schema, since @Headers() is a separate binding from @Query()) takes
// precedence over it on every reconnect; see log-tail.controller.ts's own
// header comment on that precedence order.
export const LogTailQuerySchema = z.object({
  stream: z
    .string()
    .refine(v => (LOG_STREAMS as readonly string[]).includes(v), {
      message: `stream must be one of: ${LOG_STREAMS.join(', ')}`,
    })
    .transform(v => v as LogStream),
  from: z
    .string()
    .optional()
    .transform(v => (v === undefined ? undefined : parseInt(v, 10)))
    .pipe(z.number().int().min(0).optional()),
})

export type LogTailQuery = z.infer<typeof LogTailQuerySchema>

// Phase 2 U9 (whole-file streaming scan engine) query: same R17 `stream`
// allowlist enforcement as the two schemas above. `text`/`level`/`process`/
// `event` are the plain user-facing LogScanPredicate fields — all optional,
// composing as described on that interface. `cursor` is intentionally typed
// as a bare optional string here, NOT parsed/validated by this schema at
// all: it is an opaque continuation token (see log-search.service.ts's own
// decodeCursor), not a user-facing filter value, so its own regex/range
// validation lives in the service and throws its own BadRequestException on
// a malformed value — folding that into this zod schema would either
// duplicate the service's validation or force the schema to know about the
// cursor's internal "resumeOffset:ceiling:total" encoding, which is exactly
// the kind of cross-concern coupling this split avoids.
export const LogSearchQuerySchema = z.object({
  stream: z
    .string()
    .refine(v => (LOG_STREAMS as readonly string[]).includes(v), {
      message: `stream must be one of: ${LOG_STREAMS.join(', ')}`,
    })
    .transform(v => v as LogStream),
  text: z.string().optional(),
  level: z
    .string()
    .optional()
    .transform(v => (v === undefined ? undefined : parseInt(v, 10)))
    .pipe(z.number().int().optional()),
  process: z.enum(['main', 'bot', 'both']).optional(),
  event: z.string().optional(),
  cursor: z.string().optional(),
})

export type LogSearchQuery = z.infer<typeof LogSearchQuerySchema>
