import { BadRequestException } from '@nestjs/common'
import type { z } from 'zod'

/**
 * Validates a request body against its contract schema. The error names the
 * offending fields only: never the value, which may be a password or a
 * verification code.
 */
export function parseBody<T extends z.ZodType>(
  schema: T,
  body: unknown,
): z.output<T> {
  const result = schema.safeParse(body)
  if (result.success) return result.data

  const fields = [
    ...new Set(
      result.error.issues.map(issue => issue.path.map(String).join('.')),
    ),
  ].filter(Boolean)
  throw new BadRequestException(
    fields.length > 0
      ? `Invalid request: check ${fields.join(', ')}.`
      : 'Invalid request.',
  )
}
