import { BadRequestException } from '@nestjs/common'
import { z } from 'zod'

// Shared zod schemas + safeParse→400 helper.
// @Query() delivers strings/undefined with no coercion — this module handles it.

export const CursorSchema = z
  .string()
  .optional()
  .transform(v => (v === undefined ? undefined : parseInt(v, 10)))
  .pipe(z.number().int().positive().optional())

export const LimitSchema = z
  .string()
  .optional()
  .default('50')
  .transform(v => parseInt(v, 10))
  .pipe(z.number().int().min(1).max(100))

export const PaginationSchema = z.object({
  cursor: CursorSchema,
  limit: LimitSchema,
})

export type PaginationQuery = z.infer<typeof PaginationSchema>

// Coerces raw string query params and throws BadRequestException on invalid.
export function parseQuery<T>(
  schema: z.ZodType<T>,
  raw: Record<string, string | undefined>,
): T {
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new BadRequestException(
      result.error.issues[0]?.message ?? 'Invalid query parameters',
    )
  }
  return result.data
}
