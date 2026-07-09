import { BadRequestException } from '@nestjs/common'
import { z } from 'zod'

import { PaginationSchema, parseQuery } from 'src/console/query-params'
import { EVENT_LEVELS, EVENT_TYPES } from 'src/db/schema'

const EventListQuerySchema = PaginationSchema.extend({
  type: z
    .string()
    .optional()
    .refine(
      v => v === undefined || (EVENT_TYPES as readonly string[]).includes(v),
      { message: `type must be one of: ${EVENT_TYPES.join(', ')}` },
    )
    .transform(v => v as (typeof EVENT_TYPES)[number] | undefined),
  level: z
    .string()
    .optional()
    .refine(
      v => v === undefined || (EVENT_LEVELS as readonly string[]).includes(v),
      { message: `level must be one of: ${EVENT_LEVELS.join(', ')}` },
    )
    .transform(v => v as (typeof EVENT_LEVELS)[number] | undefined),
  channel: z.string().optional(),
})

describe('parseQuery — PaginationSchema', () => {
  it('missing cursor + limit → first page defaults', () => {
    const result = parseQuery(PaginationSchema, {})
    expect(result.cursor).toBeUndefined()
    expect(result.limit).toBe(50)
  })

  it('limit as string "20" → coerced to number 20', () => {
    const result = parseQuery(PaginationSchema, { limit: '20' })
    expect(result.limit).toBe(20)
  })

  it('limit absent → default 50', () => {
    const result = parseQuery(PaginationSchema, {})
    expect(result.limit).toBe(50)
  })

  it('cursor present as string → coerced to number', () => {
    const result = parseQuery(PaginationSchema, { cursor: '42' })
    expect(result.cursor).toBe(42)
  })

  it('cursor absent → undefined (first page)', () => {
    const result = parseQuery(PaginationSchema, { limit: '10' })
    expect(result.cursor).toBeUndefined()
  })

  it('limit above max → 400', () => {
    expect(() => parseQuery(PaginationSchema, { limit: '999' })).toThrow(
      BadRequestException,
    )
  })

  it('limit = 0 → 400', () => {
    expect(() => parseQuery(PaginationSchema, { limit: '0' })).toThrow(
      BadRequestException,
    )
  })

  it('limit negative → 400', () => {
    expect(() => parseQuery(PaginationSchema, { limit: '-5' })).toThrow(
      BadRequestException,
    )
  })

  it('cursor non-numeric → 400', () => {
    expect(() => parseQuery(PaginationSchema, { cursor: 'abc' })).toThrow(
      BadRequestException,
    )
  })
})

describe('parseQuery — EventListQuerySchema', () => {
  it('valid type → accepted', () => {
    const result = parseQuery(EventListQuerySchema, { type: 'session_created' })
    expect(result.type).toBe('session_created')
  })

  it('valid level → accepted', () => {
    const result = parseQuery(EventListQuerySchema, { level: 'warn' })
    expect(result.level).toBe('warn')
  })

  it('absent type/level → undefined (no filter)', () => {
    const result = parseQuery(EventListQuerySchema, {})
    expect(result.type).toBeUndefined()
    expect(result.level).toBeUndefined()
  })

  it('invalid type → 400', () => {
    expect(() => parseQuery(EventListQuerySchema, { type: 'bogus' })).toThrow(
      BadRequestException,
    )
  })

  it('invalid level → 400', () => {
    expect(() =>
      parseQuery(EventListQuerySchema, { level: 'critical' }),
    ).toThrow(BadRequestException)
  })
})
