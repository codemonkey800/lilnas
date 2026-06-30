import { BadRequestException } from '@nestjs/common'

import { PaginationSchema, parseQuery } from 'src/console/query-params'

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
