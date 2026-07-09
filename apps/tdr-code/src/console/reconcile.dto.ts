import { z } from 'zod'

export const JsonlStatusResponseSchema = z.object({
  acpSessionId: z.string().nullable(),
  exists: z.boolean(),
  reason: z
    .enum(['no-acp-id', 'invalid-acp-session-id', 'path-traversal'])
    .optional(),
})
export type JsonlStatusResponseDto = z.infer<typeof JsonlStatusResponseSchema>

const ReconcileBlockRefSchema = z.object({
  kind: z.string(),
  text: z.string().optional(),
  title: z.string().optional(),
})

export const ReconcileResponseSchema = z.discriminatedUnion('verdict', [
  z.object({
    verdict: z.literal('cannot-reconcile'),
    reason: z.enum([
      'no-acp-id',
      'invalid-acp-session-id',
      'path-traversal',
      'file-missing',
      'parse-error',
    ]),
  }),
  z.object({
    verdict: z.literal('reconciled'),
    matched: z.number().int(),
    missingInDb: z.array(ReconcileBlockRefSchema),
    extraInDb: z.array(ReconcileBlockRefSchema),
    mismatched: z.array(
      z.object({
        kind: z.string(),
        jsonlText: z.string().optional(),
        dbText: z.string().optional(),
      }),
    ),
    skippedJsonlLines: z.number().int(),
    cappedAt: z.number().int().optional(),
  }),
])
export type ReconcileResponseDto = z.infer<typeof ReconcileResponseSchema>
