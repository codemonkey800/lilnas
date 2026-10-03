import { BadRequestException, PipeTransform } from '@nestjs/common'
import { ZodType } from 'zod'

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value)
    if (result.success) return result.data

    throw new BadRequestException({
      message: 'Invalid request body',
      issues: result.error.issues.map(i => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    })
  }
}
