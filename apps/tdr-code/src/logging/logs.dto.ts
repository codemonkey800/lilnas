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
